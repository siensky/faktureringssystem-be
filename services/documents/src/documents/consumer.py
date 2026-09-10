"""RabbitMQ-konsument för invoice.sent och invoice.credited.

architecture.md #7 FALL B — sidoeffekten är extern (S3 + senare SMTP), så:
  1. gör jobbet FÖRST: hämta snapshot, rendera PDF, ladda upp till S3
  2. markera EFTERÅT, i en transaktion: skriv documents-raden, köa mejlet,
     skriv delivery_updated-eventet, och sist processed_events

Den naturliga idempotensnyckeln UNIQUE (tenant_id, invoice_id,
document_type) i `documents` ÄR garantin. processed_events är bara en
optimering som slipper göra om S3-arbetet — en tidig SELECT på den, och en
sista INSERT ON CONFLICT DO NOTHING.

Felhantering:
  - ogiltig envelope/payload   -> ack (permanent skräp)
  - snapshot 404 / 401 / 403   -> ack + error-logg. Billing skrev aldrig
                                  snapshoten, eller tenanten är borttagen/
                                  avstängd — inget av det löser sig av att
                                  vänta.
  - övrigt (S3/DB/billing nere) -> nack med requeue efter kort paus, men
                                  BARA första gången. Är meddelandet redan
                                  omlevererat och felar igen ges det upp
                                  (ack + larm) så en förgiftad rad inte
                                  loopar hett. En riktig dead-letter-kö med
                                  larm och en genomtänkt retry-policy
                                  läggs till i fas 7.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any

import aio_pika
import asyncpg

from . import repository
from .billing_client import BillingClient, SnapshotAccessDenied, SnapshotNotFound
from .config import Settings
from .contracts import (
    EnvelopeValidationError,
    PayloadValidationError,
    assert_valid_envelope,
    assert_valid_payload,
)
from .rendering import document_type_of, render_pdf
from .s3 import put_pdf, storage_key

QUEUE = "documents.events"
ROUTING_KEYS = ("invoice.sent", "invoice.credited")
REQUEUE_DELAY_SECONDS = 1.0
PREFETCH = 5


def _subject(snapshot: dict[str, Any], document_type: str) -> str:
    number = snapshot["invoice"].get("invoiceNumber")
    company = snapshot["company"].get("name") or "Faktura"
    if document_type == "credit_note":
        return f"Kreditfaktura {number} från {company}"
    return f"Faktura {number} från {company}"


class EventConsumer:
    def __init__(
        self,
        *,
        connection: aio_pika.abc.AbstractConnection,
        pool: asyncpg.Pool,
        settings: Settings,
        billing: BillingClient,
        logger: Any,
    ) -> None:
        self._connection = connection
        self._pool = pool
        self._settings = settings
        self._billing = billing
        self._logger = logger
        self._channel: aio_pika.abc.AbstractChannel | None = None

    async def start(self) -> None:
        # Egen kanal, skild från ping-kanalen, så prefetch här inte stryper
        # system-pingen.
        self._channel = await self._connection.channel()
        await self._channel.set_qos(prefetch_count=PREFETCH)
        # 'events' deklareras av infra/rabbitmq/init.sh; documents-kontot har
        # inte 'configure' på det, så vi binder bara mot namnet.
        queue = await self._channel.declare_queue(QUEUE, durable=True)
        for key in ROUTING_KEYS:
            await queue.bind("events", routing_key=key)
        await queue.consume(self._on_message)

    async def stop(self) -> None:
        if self._channel is not None:
            await self._channel.close()

    async def _on_message(self, message: aio_pika.abc.AbstractIncomingMessage) -> None:
        try:
            envelope = json.loads(message.body.decode("utf-8"))
            assert_valid_envelope(envelope)
            assert_valid_payload(envelope["eventType"], envelope["payload"])
            await self._handle(envelope)
            await message.ack()
        except (EnvelopeValidationError, PayloadValidationError) as error:
            self._logger.error("consumer: ogiltigt event, kastas utan requeue", error=str(error))
            await message.ack()
        except (SnapshotNotFound, SnapshotAccessDenied) as error:
            self._logger.error(
                "consumer: snapshot ej tillgänglig, kastas utan requeue", error=str(error)
            )
            await message.ack()
        except Exception as error:  # noqa: BLE001
            if message.redelivered:
                self._logger.error(
                    "consumer: transient fel även vid omleverans — ger upp (se fas 7 DLQ)",
                    error_type=type(error).__name__,
                    error=str(error),
                )
                await message.ack()
                return
            self._logger.warning(
                "consumer: transient fel, requeue efter paus",
                error_type=type(error).__name__,
                error=str(error),
            )
            await asyncio.sleep(REQUEUE_DELAY_SECONDS)
            await message.nack(requeue=True)

    async def _handle(self, envelope: dict[str, Any]) -> None:
        event_id = envelope["eventId"]
        tenant_id = envelope["tenantId"]
        correlation_id = envelope["correlationId"]
        invoice_id = int(envelope["payload"]["invoiceId"])

        # Optimering (inte garantin): hoppa över om redan hanterat.
        async with self._pool.acquire() as conn:
            if await repository.already_processed(conn, event_id):
                return

        # 1. Jobbet först (fall B).
        snapshot = await self._billing.fetch_snapshot(
            invoice_id=invoice_id, tenant_id=tenant_id, correlation_id=correlation_id
        )
        document_type = document_type_of(snapshot)
        pdf_bytes = await asyncio.to_thread(render_pdf, snapshot)
        sha256 = hashlib.sha256(pdf_bytes).hexdigest()
        key = storage_key(tenant_id, invoice_id, document_type)
        await put_pdf(self._settings, key, pdf_bytes)  # självskrivande nyckel

        recipient = snapshot["customer"].get("email")
        subject = _subject(snapshot, document_type)

        # 2. Markera efteråt, allt i EN transaktion.
        async with self._pool.acquire() as conn, conn.transaction():
            document_id = await repository.insert_document(
                conn,
                tenant_id=tenant_id,
                invoice_id=invoice_id,
                document_type=document_type,
                storage_key=key,
                byte_size=len(pdf_bytes),
                sha256=sha256,
            )
            if document_id is not None:
                # Ny PDF -> köa mejlet och rapportera 'queued' till billing.
                # Fanns raden redan gjordes bådadera vid förra körningen.
                await repository.enqueue_email(
                    conn,
                    tenant_id=tenant_id,
                    invoice_id=invoice_id,
                    email_type=document_type,
                    document_id=document_id,
                    recipient_email=recipient,
                    subject=subject,
                    correlation_id=correlation_id,
                )
                await repository.write_event(
                    conn,
                    event_type="invoice.delivery_updated",
                    tenant_id=tenant_id,
                    correlation_id=correlation_id,
                    payload={
                        "invoiceId": invoice_id,
                        "documentType": document_type,
                        "deliveryStatus": "queued",
                    },
                )
            await repository.mark_processed(conn, event_id)

        self._logger.info(
            "consumer: dokument genererat",
            event_id=event_id,
            invoice_id=invoice_id,
            document_type=document_type,
            regenerated=document_id is None,
        )

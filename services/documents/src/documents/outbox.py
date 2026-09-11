"""Transactional outbox-publisher för documents — Python-motsvarigheten
till packages/shared/src/outbox/index.ts.

architecture.md #6: affärslogiken skriver bara event_outbox-rader (i samma
transaktion som affärsdatan), ALDRIG direkt till RabbitMQ. Den här loopen
är enda stället som publicerar. Samma härdning som TS-sidan: exponentiell
backoff vid fel, dead-letter efter MAX_ATTEMPTS, larm via on_dead_letter.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import Any

import aio_pika
import asyncpg

from . import repository
from .contracts import (
    EnvelopeValidationError,
    PayloadValidationError,
    assert_valid_envelope,
    assert_valid_payload,
)


class PublishTimeoutError(Exception):
    def __init__(self) -> None:
        super().__init__(f"brokern bekräftade inte inom {PUBLISH_CONFIRM_TIMEOUT_SECONDS} s")


POLL_INTERVAL_SECONDS = 1.0
BATCH_SIZE = 20
MAX_ATTEMPTS = 12
BACKOFF_BASE_SECONDS = 5
BACKOFF_CAP_SECONDS = 3600
# Publiceringstransaktionen håller radlås på hela batchen medan den väntar
# på brokerns confirm (aio_pika:s channel(publisher_confirms=True), satt i
# main.py). En hängd broker får inte pinna den obegränsat — samma
# resonemang och samma tidsgräns som packages/shared/src/outbox/index.ts
# PUBLISH_CONFIRM_TIMEOUT_MS på TS-sidan (PR-granskning fas 4, punkt 20).
PUBLISH_CONFIRM_TIMEOUT_SECONDS = 5.0


def backoff_seconds(attempts: int) -> int:
    return min(BACKOFF_BASE_SECONDS * (2**attempts), BACKOFF_CAP_SECONDS)


def _envelope(row: asyncpg.Record) -> dict[str, Any]:
    payload = row["payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)
    return {
        "eventId": str(row["event_id"]),
        "eventType": row["event_type"],
        "tenantId": row["tenant_id"],
        "correlationId": str(row["correlation_id"]),
        "occurredAt": row["occurred_at"].isoformat().replace("+00:00", "Z"),
        "payload": payload,
    }


class OutboxPublisher:
    def __init__(
        self,
        pool: asyncpg.Pool,
        exchange: aio_pika.abc.AbstractExchange,
        logger: Any,
        on_dead_letter: Callable[[str, str, Exception], None] | None = None,
    ) -> None:
        self._pool = pool
        self._exchange = exchange
        self._logger = logger
        self._on_dead_letter = on_dead_letter
        self._task: asyncio.Task | None = None
        self._stopped = asyncio.Event()

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stopped.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        while not self._stopped.is_set():
            try:
                await self._tick()
            except Exception as error:  # noqa: BLE001 — loopen får aldrig dö
                self._logger.error("outbox: publisher-varv misslyckades", error=str(error))
            try:
                await asyncio.wait_for(self._stopped.wait(), timeout=POLL_INTERVAL_SECONDS)
            except TimeoutError:
                pass

    async def _tick(self) -> None:
        async with self._pool.acquire() as conn, conn.transaction():
            rows = await repository.claim_outbox_batch(conn, limit=BATCH_SIZE)
            broker_stalled = False
            for row in rows:
                if broker_stalled:
                    # En hängd broker — låt resten av batchen vänta till
                    # nästa varv i stället för att vänta ut timeouten
                    # BATCH_SIZE gånger i rad i samma öppna transaktion.
                    break
                envelope = _envelope(row)
                try:
                    self._validate(envelope)
                except (EnvelopeValidationError, PayloadValidationError) as error:
                    # Ett schemafel är DETERMINISTISKT och PERMANENT — samma
                    # payload ger samma fel varje gång. Att backa av och
                    # försöka igen i timmar (upp till MAX_ATTEMPTS) hjälper
                    # aldrig; dead-lettra direkt (PR-granskning fas 4,
                    # punkt 21).
                    await self._dead_letter(conn, row, error)
                    continue
                try:
                    await self._publish_with_timeout(envelope)
                    await repository.mark_event_published(conn, str(row["event_id"]))
                except Exception as error:  # noqa: BLE001
                    if isinstance(error, PublishTimeoutError):
                        broker_stalled = True
                    await self._retry_or_dead_letter(conn, row, error)

    @staticmethod
    def _validate(envelope: dict[str, Any]) -> None:
        assert_valid_envelope(envelope)
        assert_valid_payload(envelope["eventType"], envelope["payload"])

    async def _publish_with_timeout(self, envelope: dict[str, Any]) -> None:
        message = aio_pika.Message(
            body=json.dumps(envelope).encode("utf-8"),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        )
        try:
            await asyncio.wait_for(
                self._exchange.publish(message, routing_key=envelope["eventType"]),
                timeout=PUBLISH_CONFIRM_TIMEOUT_SECONDS,
            )
        except TimeoutError as err:
            raise PublishTimeoutError() from err

    async def _dead_letter(
        self, conn: asyncpg.Connection, row: asyncpg.Record, error: Exception
    ) -> None:
        attempts = row["attempts"] + 1
        await repository.mark_event_dead_letter(
            conn, event_id=str(row["event_id"]), attempts=attempts, error=str(error)
        )
        self._logger.error(
            "outbox: event dead-letter:at",
            event_id=str(row["event_id"]),
            event_type=row["event_type"],
            attempts=attempts,
            error=str(error),
        )
        if self._on_dead_letter is not None:
            self._on_dead_letter(str(row["event_id"]), row["event_type"], error)

    async def _retry_or_dead_letter(
        self, conn: asyncpg.Connection, row: asyncpg.Record, error: Exception
    ) -> None:
        next_attempts = row["attempts"] + 1
        if next_attempts >= MAX_ATTEMPTS:
            await self._dead_letter(conn, row, error)
            return
        await repository.mark_event_retry(
            conn,
            event_id=str(row["event_id"]),
            attempts=next_attempts,
            error=str(error),
            backoff_seconds=backoff_seconds(row["attempts"]),
        )
        self._logger.warning(
            "outbox: kunde inte publicera event, backar av",
            event_id=str(row["event_id"]),
            attempts=next_attempts,
            error=str(error),
        )

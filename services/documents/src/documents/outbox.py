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
from .contracts import assert_valid_envelope, assert_valid_payload

POLL_INTERVAL_SECONDS = 1.0
BATCH_SIZE = 20
MAX_ATTEMPTS = 12
BACKOFF_BASE_SECONDS = 5
BACKOFF_CAP_SECONDS = 3600


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
            for row in rows:
                envelope = _envelope(row)
                try:
                    assert_valid_envelope(envelope)
                    assert_valid_payload(envelope["eventType"], envelope["payload"])
                    await self._exchange.publish(
                        aio_pika.Message(
                            body=json.dumps(envelope).encode("utf-8"),
                            content_type="application/json",
                            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                        ),
                        routing_key=envelope["eventType"],
                    )
                    await repository.mark_event_published(conn, str(row["event_id"]))
                except Exception as error:  # noqa: BLE001
                    next_attempts = row["attempts"] + 1
                    if next_attempts >= MAX_ATTEMPTS:
                        await repository.mark_event_dead_letter(
                            conn,
                            event_id=str(row["event_id"]),
                            attempts=next_attempts,
                            error=str(error),
                        )
                        self._logger.error(
                            "outbox: event dead-letter:at efter maxantal försök",
                            event_id=str(row["event_id"]),
                            event_type=row["event_type"],
                            error=str(error),
                        )
                        if self._on_dead_letter is not None:
                            self._on_dead_letter(str(row["event_id"]), row["event_type"], error)
                    else:
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

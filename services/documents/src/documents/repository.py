"""ALL SQL för documents (code-style.md #22). Funktioner tar ett asyncpg
Connection så anroparen bestämmer transaktionsgränsen — flera av
skrivningarna nedan måste ligga i EN transaktion (se consumer.py och
webhooks.py).

Tabeller: documents, email_outbox, email_webhook_events (0005_documents),
samt de delade event_outbox / processed_events (0003_shared, filtrerade på
source_service='documents' respektive consumer='documents').
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import asyncpg

CONSUMER = "documents"
SOURCE_SERVICE = "documents"


# ── processed_events (dedup av inkommande event, architecture.md #7) ─────


async def already_processed(conn: asyncpg.Connection, event_id: str) -> bool:
    row = await conn.fetchrow(
        "SELECT 1 FROM processed_events WHERE event_id = $1 AND consumer = $2",
        event_id,
        CONSUMER,
    )
    return row is not None


async def mark_processed(conn: asyncpg.Connection, event_id: str) -> None:
    await conn.execute(
        """
        INSERT INTO processed_events (event_id, consumer)
        VALUES ($1, $2)
        ON CONFLICT (event_id, consumer) DO NOTHING
        """,
        event_id,
        CONSUMER,
    )


# ── documents (en rad per genererad PDF) ────────────────────────────────


async def insert_document(
    conn: asyncpg.Connection,
    *,
    tenant_id: int,
    invoice_id: int,
    document_type: str,
    storage_key: str,
    byte_size: int,
    sha256: str,
) -> int | None:
    """INSERT ... ON CONFLICT DO NOTHING. Returnerar id om raden var NY,
    None om den redan fanns (dubblettleverans — den naturliga
    idempotensnyckeln, architecture.md #7 fall B)."""
    row = await conn.fetchrow(
        """
        INSERT INTO documents
          (tenant_id, invoice_id, document_type, storage_key, byte_size, sha256)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (tenant_id, invoice_id, document_type) DO NOTHING
        RETURNING id
        """,
        tenant_id,
        invoice_id,
        document_type,
        storage_key,
        byte_size,
        sha256,
    )
    return row["id"] if row else None


async def find_document(
    conn: asyncpg.Connection, *, tenant_id: int, invoice_id: int
) -> asyncpg.Record | None:
    return await conn.fetchrow(
        """
        SELECT id, document_type, storage_key, byte_size, sha256
        FROM documents
        WHERE tenant_id = $1 AND invoice_id = $2
        LIMIT 1
        """,
        tenant_id,
        invoice_id,
    )


# ── email_outbox (ett utskick per faktura, villkorade övergångar) ───────


async def enqueue_email(
    conn: asyncpg.Connection,
    *,
    tenant_id: int,
    invoice_id: int,
    email_type: str,
    document_id: int,
    recipient_email: str,
    subject: str,
    correlation_id: str,
) -> None:
    await conn.execute(
        """
        INSERT INTO email_outbox
          (tenant_id, invoice_id, email_type, document_id, recipient_email, subject, correlation_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (tenant_id, invoice_id, email_type) DO NOTHING
        """,
        tenant_id,
        invoice_id,
        email_type,
        document_id,
        recipient_email,
        subject,
        correlation_id,
    )


async def lease_queued_emails(
    conn: asyncpg.Connection, *, limit: int, backoff_seconds: int
) -> list[asyncpg.Record]:
    """ "Leasar" köade, mogna rader genom att skjuta fram next_attempt_at och
    räkna upp attempts — en samtidig arbetare (FOR UPDATE SKIP LOCKED)
    hoppar då över dem. Raden står kvar som 'queued'; själva övergången
    till 'sent'/'failed' är en separat villkorad UPDATE efter att SMTP
    svarat. Kör i egen transaktion."""
    return await conn.fetch(
        """
        UPDATE email_outbox
        SET attempts = attempts + 1,
            next_attempt_at = now() + ($2 || ' seconds')::interval,
            updated_at = now()
        WHERE id IN (
          SELECT id FROM email_outbox
          WHERE status = 'queued' AND next_attempt_at <= now()
          ORDER BY next_attempt_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        RETURNING id, tenant_id, invoice_id, email_type, document_id,
                  recipient_email, subject, correlation_id, attempts
        """,
        limit,
        str(backoff_seconds),
    )


async def mark_email_sent(
    conn: asyncpg.Connection, *, email_id: int, provider_message_id: str
) -> int:
    """Villkorad övergång 'queued' -> 'sent' (planens idempotensavsnitt #6).
    Returnerar antalet ändrade rader (0 = någon annan hann före)."""
    result = await conn.execute(
        """
        UPDATE email_outbox
        SET status = 'sent', sent_at = now(), provider_message_id = $2, updated_at = now()
        WHERE id = $1 AND status = 'queued'
        """,
        email_id,
        provider_message_id,
    )
    return _rowcount(result)


async def mark_email_failed(conn: asyncpg.Connection, *, email_id: int, error: str) -> int:
    """Villkorad övergång 'queued' -> 'failed' efter uttömda försök."""
    result = await conn.execute(
        """
        UPDATE email_outbox
        SET status = 'failed', failed_at = now(), last_error = $2, updated_at = now()
        WHERE id = $1 AND status = 'queued'
        """,
        email_id,
        error[:2000],
    )
    return _rowcount(result)


async def record_email_error(conn: asyncpg.Connection, *, email_id: int, error: str) -> None:
    await conn.execute(
        "UPDATE email_outbox SET last_error = $2, updated_at = now() WHERE id = $1",
        email_id,
        error[:2000],
    )


async def find_email_by_message_id(
    conn: asyncpg.Connection, provider_message_id: str
) -> asyncpg.Record | None:
    return await conn.fetchrow(
        """
        SELECT id, tenant_id, invoice_id, email_type, status, correlation_id
        FROM email_outbox
        WHERE provider_message_id = $1
        LIMIT 1
        """,
        provider_message_id,
    )


async def advance_email_status(
    conn: asyncpg.Connection, *, email_id: int, from_statuses: list[str], to_status: str
) -> int:
    """Monoton, villkorad övergång: skriver bara om raden står i ett av
    from_statuses. Returnerar antalet ändrade rader."""
    result = await conn.execute(
        """
        UPDATE email_outbox
        SET status = $3,
            delivered_at = CASE WHEN $3 = 'delivered' THEN now() ELSE delivered_at END,
            failed_at = CASE WHEN $3 IN ('bounced', 'failed') THEN now() ELSE failed_at END,
            updated_at = now()
        WHERE id = $1 AND status = ANY($2::text[])
        """,
        email_id,
        from_statuses,
        to_status,
    )
    return _rowcount(result)


# ── email_webhook_events (global dedup av leverantörens event-id) ───────


async def webhook_event_is_new(conn: asyncpg.Connection, *, provider: str, event_id: str) -> bool:
    """True om (provider, event_id) inte setts förr. INSERT ON CONFLICT DO
    NOTHING — krocken är svaret (planens Säkerhet: Webhooks #2)."""
    result = await conn.execute(
        """
        INSERT INTO email_webhook_events (provider, event_id)
        VALUES ($1, $2)
        ON CONFLICT (provider, event_id) DO NOTHING
        """,
        provider,
        event_id,
    )
    return _rowcount(result) == 1


# ── event_outbox (utgående event, architecture.md #6) ───────────────────


async def write_event(
    conn: asyncpg.Connection,
    *,
    event_type: str,
    tenant_id: int,
    correlation_id: str,
    payload: dict[str, Any],
) -> str:
    """Skriver ett event till outboxen i den medskickade transaktionen.
    Publiceras vidare av OutboxPublisher (outbox.py). event_id sätts här —
    samma id följer med vid en omsänd leverans (det som gör konsumentens
    dedup möjlig)."""
    event_id = str(uuid.uuid4())
    await conn.execute(
        """
        INSERT INTO event_outbox
          (event_id, source_service, event_type, tenant_id, correlation_id, payload)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        """,
        event_id,
        SOURCE_SERVICE,
        event_type,
        tenant_id,
        correlation_id,
        json.dumps(payload),
    )
    return event_id


async def claim_outbox_batch(conn: asyncpg.Connection, *, limit: int) -> list[asyncpg.Record]:
    """Plockar opublicerade, icke-dead-letter, mogna rader för
    source_service='documents' med FOR UPDATE SKIP LOCKED. Kör i den
    transaktion som sedan markerar dem publicerade."""
    return await conn.fetch(
        """
        SELECT event_id, event_type, tenant_id, correlation_id, payload, occurred_at, attempts
        FROM event_outbox
        WHERE source_service = $1
          AND published_at IS NULL
          AND failed_at IS NULL
          AND next_attempt_at <= now()
        ORDER BY occurred_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED
        """,
        SOURCE_SERVICE,
        limit,
    )


async def mark_event_published(conn: asyncpg.Connection, event_id: str) -> None:
    await conn.execute(
        "UPDATE event_outbox SET published_at = now() WHERE event_id = $1",
        event_id,
    )


async def mark_event_retry(
    conn: asyncpg.Connection, *, event_id: str, attempts: int, error: str, backoff_seconds: int
) -> None:
    await conn.execute(
        """
        UPDATE event_outbox
        SET attempts = $2,
            last_error = $3,
            next_attempt_at = now() + ($4 || ' seconds')::interval
        WHERE event_id = $1
        """,
        event_id,
        attempts,
        error[:2000],
        str(backoff_seconds),
    )


async def mark_event_dead_letter(
    conn: asyncpg.Connection, *, event_id: str, attempts: int, error: str
) -> None:
    await conn.execute(
        """
        UPDATE event_outbox
        SET attempts = $2, last_error = $3, failed_at = now()
        WHERE event_id = $1
        """,
        event_id,
        attempts,
        error[:2000],
    )


def _rowcount(execute_result: str) -> int:
    # asyncpg .execute() returnerar t.ex. "UPDATE 1" / "INSERT 0 1".
    return int(execute_result.rsplit(" ", 1)[-1])

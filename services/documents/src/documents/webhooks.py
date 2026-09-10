"""POST /webhooks/email-status — leverantörens statusrapporter för skickade
mejl. Uppdaterar email_outbox och rapporterar vidare till billing via ett
invoice.delivery_updated-event.

Tre skydd (planens Säkerhet: Webhooks, domain.md #24–25):
  1. Signaturen räknas över RÅ body, INNAN JSON parsas. Signaturbasen är
     "<timestamp>.<rå body>" så tidsstämpeln inte kan bytas ut fritt.
  2. Replayskydd: tidsstämpeln måste ligga inom ±5 minuter, OCH
     leverantörens event-id dedupas globalt (email_webhook_events).
  3. Monoton status: övergången är villkorad (advance_email_status skriver
     bara från ett lägre-rankat läge), så en försenad 'delivered' inte kan
     återuppliva en död adress (domain.md #29).

invoices.status rörs aldrig — bara delivery_status, via eventet.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import asyncpg
from fastapi import APIRouter, HTTPException, Request

from . import repository
from .config import Settings
from .delivery import DELIVERY_RANK, delivery_rank, map_webhook_status

PROVIDER = "email"
TIMESTAMP_TOLERANCE_SECONDS = 300


def verify_signature(*, secret: str, timestamp: str, raw_body: bytes, signature: str) -> bool:
    base = timestamp.encode("utf-8") + b"." + raw_body
    expected = hmac.new(secret.encode("utf-8"), base, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def timestamp_fresh(
    timestamp: str, *, now: float, tolerance: int = TIMESTAMP_TOLERANCE_SECONDS
) -> bool:
    try:
        sent_at = float(timestamp)
    except (TypeError, ValueError):
        return False
    return abs(now - sent_at) <= tolerance


def _lower_ranked_statuses(target: str) -> list[str]:
    """De email_outbox-statusar som får övergå TILL target (strikt lägre
    rank). 'none' hör bara till billings kolumn, inte email_outbox."""
    target_rank = delivery_rank(target)
    return [s for s, r in DELIVERY_RANK.items() if s != "none" and 0 < r < target_rank]


def create_webhook_router(settings: Settings, pool_getter) -> APIRouter:
    router = APIRouter()

    @router.post("/webhooks/email-status")
    async def email_status(request: Request) -> dict[str, Any]:
        raw = await request.body()
        signature = request.headers.get("x-signature", "")
        timestamp = request.headers.get("x-timestamp", "")

        # 1. Signatur FÖRST, över rå body.
        if not verify_signature(
            secret=settings.email_webhook_secret,
            timestamp=timestamp,
            raw_body=raw,
            signature=signature,
        ):
            raise HTTPException(status_code=401, detail="Ogiltig signatur")

        # 2. Replayfönster.
        if not timestamp_fresh(timestamp, now=time.time()):
            raise HTTPException(status_code=400, detail="Tidsstämpeln är utanför tillåtet fönster")

        try:
            body = json.loads(raw)
        except json.JSONDecodeError as err:
            raise HTTPException(status_code=400, detail="Ogiltig JSON") from err

        event_id = body.get("id")
        # Normalisera bort ev. vinkelparenteser — leverantörer rapporterar
        # Message-ID:t olika, och vi lagrar det utan (email_worker).
        message_id = (body.get("messageId") or "").strip("<>")
        provider_status = body.get("status")
        bounce_type = body.get("bounceType")
        if not event_id or not message_id or not provider_status:
            raise HTTPException(status_code=400, detail="id, messageId och status krävs")

        try:
            target_status = map_webhook_status(provider_status)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

        pool: asyncpg.Pool = pool_getter()

        email_row = await _find_email(pool, message_id)
        if email_row is None:
            # Okänt meddelande — kvittera 200 så leverantören slutar
            # försöka, men logga: det kan vara en bugg eller ett angrepp.
            return {"status": "ignored_unknown_message"}

        async with pool.acquire() as conn, conn.transaction():
            fresh = await repository.webhook_event_is_new(
                conn, provider=PROVIDER, event_id=str(event_id)
            )
            if not fresh:
                return {"status": "duplicate"}

            changed = await repository.advance_email_status(
                conn,
                email_id=email_row["id"],
                from_statuses=_lower_ranked_statuses(target_status),
                to_status=target_status,
            )
            if changed == 1:
                payload: dict[str, Any] = {
                    "invoiceId": email_row["invoice_id"],
                    "documentType": email_row["email_type"],
                    "deliveryStatus": target_status,
                }
                if target_status == "bounced" and bounce_type in ("hard", "soft"):
                    payload["bounceType"] = bounce_type
                await repository.write_event(
                    conn,
                    event_type="invoice.delivery_updated",
                    tenant_id=email_row["tenant_id"],
                    correlation_id=str(email_row["correlation_id"]),
                    payload=payload,
                )

        return {"status": "accepted", "applied": changed == 1}

    return router


async def _find_email(pool: asyncpg.Pool, message_id: str) -> asyncpg.Record | None:
    async with pool.acquire() as conn:
        return await repository.find_email_by_message_id(conn, message_id)

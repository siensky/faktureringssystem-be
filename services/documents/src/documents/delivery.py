"""Rena hjälpare kring leveransstatus — ingen DB, inget nätverk, så de kan
enhetstestas ensamma och delas mellan konsumenten, e-postarbetaren och
webhooken.

delivery_status är MONOTON (domain.md #29): billing skriver bara framåt i
DELIVERY_RANK, och samma ordning styr e-postarbetarens och webhookens
villkorade UPDATE. Ordningen läses ur packages/contracts/schemas/
delivery-status-rank.json — SAMMA fil som TS-sidan (services/billing/src/
deliveries/repository.ts) läser — i stället för en hårdkodad kopia här som
annars kan glida isär tyst (PR-granskning fas 4, punkt 14). Se filens
"$comment" för resonemanget bakom själva ordningen (varför 'delivered' och
'bounced' är terminala och 'failed' inte får skriva över någon av dem).
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

# Samma relativa djup som contracts.py (se kommentaren där): den här filen
# ligger på services/documents/src/documents/delivery.py.
# parents[0]=documents(pkg) [1]=src [2]=documents(tjänsteroten)
# [3]=services [4]=repo-roten (eller motsvarande /app i Docker-imagen).
_RANK_FILE = (
    Path(__file__).resolve().parents[4]
    / "packages"
    / "contracts"
    / "schemas"
    / "delivery-status-rank.json"
)


@cache
def _order() -> tuple[str, ...]:
    with _RANK_FILE.open("r", encoding="utf-8") as f:
        return tuple(json.load(f)["order"])


@cache
def _rank_map() -> dict[str, int]:
    return {status: index for index, status in enumerate(_order())}


# Leverantörens webhook-status -> vår email_outbox/delivery-status.
WEBHOOK_STATUS_MAP: dict[str, str] = {
    "delivered": "delivered",
    "bounced": "bounced",
    "failed": "failed",
}


def delivery_status_order() -> tuple[str, ...]:
    return _order()


def delivery_rank(status: str) -> int:
    try:
        return _rank_map()[status]
    except KeyError as err:
        raise ValueError(f"okänd delivery_status: {status!r}") from err


def is_progress(current: str, candidate: str) -> bool:
    """True om candidate rankas STRIKT högre än current (ett äkta framsteg)."""
    return delivery_rank(candidate) > delivery_rank(current)


def map_webhook_status(provider_status: str) -> str:
    try:
        return WEBHOOK_STATUS_MAP[provider_status]
    except KeyError as err:
        raise ValueError(f"okänd webhook-status: {provider_status!r}") from err

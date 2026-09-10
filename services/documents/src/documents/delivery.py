"""Rena hjälpare kring leveransstatus — ingen DB, inget nätverk, så de kan
enhetstestas ensamma och delas mellan konsumenten, e-postarbetaren och
webhooken.

delivery_status är MONOTON (domain.md #29): billing skriver bara framåt i
den här ordningen, och samma ordning styr e-postarbetarens och webhookens
villkorade UPDATE. Terminala utfall (failed/bounced) rankas högst så inget
"framsteg" kan skriva över dem; bounced över failed eftersom en studs är
ett starkare besked om adressen än ett generiskt sändfel.
"""

from __future__ import annotations

DELIVERY_RANK: dict[str, int] = {
    "none": 0,
    "queued": 1,
    "sent": 2,
    "delivered": 3,
    "failed": 4,
    "bounced": 5,
}

# Leverantörens webhook-status -> vår email_outbox/delivery-status.
WEBHOOK_STATUS_MAP: dict[str, str] = {
    "delivered": "delivered",
    "bounced": "bounced",
    "failed": "failed",
}


def delivery_rank(status: str) -> int:
    try:
        return DELIVERY_RANK[status]
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

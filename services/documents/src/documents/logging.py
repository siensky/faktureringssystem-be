"""Strukturerad loggning (structlog) med samma maskeringsregel som
packages/shared/src/logger/index.ts på TS-sidan — domain.md #19: personnummer,
lösenord och tokens loggas aldrig. Ett skyddsnät, inte en ursäkt för att
slarva; samma reservation som på TS-sidan gäller här.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

REDACTED = "[REDACTED]"

_SENSITIVE_KEYS = {
    "password",
    "password_hash",
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "client_secret",
    "authorization",
    "pnr",
    "personnummer",
    "pnr_hash",
    "pnr_hmac",
    "pnr_encrypted",
    "reset_token",
    "signed_url",
}


def _redact_sensitive(
    _logger: Any, _method_name: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    """Maskerar kända känsliga fältnamn på valfritt djup i event_dict."""

    def scrub(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                key: (REDACTED if key.lower() in _SENSITIVE_KEYS else scrub(val))
                for key, val in value.items()
            }
        if isinstance(value, list):
            return [scrub(item) for item in value]
        return value

    return scrub(event_dict)


def configure_logging(service_name: str, level: str = "info") -> None:
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _redact_sensitive,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    structlog.contextvars.bind_contextvars(name=service_name)


def get_logger() -> structlog.stdlib.BoundLogger:
    return structlog.get_logger()

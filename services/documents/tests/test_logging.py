import io
import json

import structlog

from documents.logging import configure_logging


def _capture_one_log_line(log_fn) -> dict:
    """Konfigurerar loggning mot en fångad stream, loggar en rad via
    log_fn, och returnerar den parsade JSON-raden."""
    buffer = io.StringIO()
    configure_logging("test-service", "info")
    # structlog.PrintLoggerFactory skriver till sys.stdout som standard;
    # vi byter ut den mot vår buffer för att kunna läsa tillbaka raden.
    structlog.configure(
        processors=structlog.get_config()["processors"],
        wrapper_class=structlog.get_config()["wrapper_class"],
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=buffer),
        cache_logger_on_first_use=False,
    )
    logger = structlog.get_logger()
    log_fn(logger)
    line = buffer.getvalue().strip().splitlines()[-1]
    return json.loads(line)


def test_maskerar_password():
    logged = _capture_one_log_line(
        lambda log: log.info("login attempt", email="a@example.com", password="hemligt123")
    )
    assert logged["password"] == "[REDACTED]"
    assert logged["email"] == "a@example.com"


def test_maskerar_personnummer_pa_djupet():
    logged = _capture_one_log_line(
        lambda log: log.info("test", nested={"pnr": "19850101-2389", "ok": "kept"})
    )
    assert logged["nested"]["pnr"] == "[REDACTED]"
    assert logged["nested"]["ok"] == "kept"


def test_ovriga_falt_loggas_oforandrat():
    logged = _capture_one_log_line(lambda log: log.info("test", invoice_id=42, status="matched"))
    assert logged["invoice_id"] == 42
    assert logged["status"] == "matched"

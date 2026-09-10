"""Läser samma JSON Schema-filer som packages/contracts (TS-sidan) och
validerar mot dem — planens "packages/contracts når även Python". Ingen typ
eller regel skrivs separat här; schemat i packages/contracts/schemas/ är den
enda källan till sanning, för båda språken.

Sökvägen räknas fram relativt den här filens plats, på ett sätt som ger
SAMMA relativa djup lokalt (repo-checkout) och i Docker (se
services/documents/Dockerfile, som speglar hela monorepo-layouten in i
imagen i stället för att platta ut den) — ingen miljövariabel behövs för att
skilja de två fallen åt.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError

# Denna fil ligger på services/documents/src/documents/contracts.py.
# parents[0]=documents(pkg) [1]=src [2]=documents(tjänsteroten)
# [3]=services [4]=repo-roten (eller motsvarande /app i Docker-imagen,
# där samma relativa layout är bevarad).
_REPO_ROOT = Path(__file__).resolve().parents[4]
_SCHEMAS_DIR = _REPO_ROOT / "packages" / "contracts" / "schemas"


class EnvelopeValidationError(ValueError):
    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__(f"Ogiltig event-envelope: {'; '.join(errors)}")


class PayloadValidationError(ValueError):
    def __init__(self, event_type: str, errors: list[str]) -> None:
        self.event_type = event_type
        self.errors = errors
        super().__init__(f"Ogiltig payload för {event_type}: {'; '.join(errors)}")


@cache
def _load_schema(relative_path: str) -> dict[str, Any]:
    path = _SCHEMAS_DIR / relative_path
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


@cache
def _envelope_validator() -> Draft202012Validator:
    schema = _load_schema("envelope.schema.json")
    return Draft202012Validator(schema, format_checker=FormatChecker())


def _payload_schema_path(event_type: str) -> str:
    # invoice.sent -> events/invoice-sent.schema.json
    # invoice.delivery_updated -> events/invoice-delivery-updated.schema.json
    slug = event_type.replace(".", "-").replace("_", "-")
    return f"events/{slug}.schema.json"


@cache
def _payload_validator(event_type: str) -> Draft202012Validator:
    schema = _load_schema(_payload_schema_path(event_type))
    return Draft202012Validator(schema, format_checker=FormatChecker())


def is_valid_envelope(data: Any) -> bool:
    return _envelope_validator().is_valid(data)


def assert_valid_envelope(data: Any) -> None:
    """Kastar EnvelopeValidationError om data inte matchar envelope-schemat.
    architecture.md #4: saknas tenantId går eventet till dead-letter — det
    gissas aldrig, och det stoppas redan här vid gränsen.
    """
    validator = _envelope_validator()
    errors: list[ValidationError] = sorted(validator.iter_errors(data), key=str)
    if errors:
        raise EnvelopeValidationError([e.message for e in errors])


def is_valid_payload(event_type: str, payload: Any) -> bool:
    try:
        return _payload_validator(event_type).is_valid(payload)
    except FileNotFoundError:
        return False


def assert_valid_payload(event_type: str, payload: Any) -> None:
    """Kastar PayloadValidationError om payloaden inte matchar sin eventtyp.
    Ett eventtyp utan schema är ett kodfel (felstavat eller glömt schema),
    inte en tyst genomsläppning — det ska synas."""
    try:
        validator = _payload_validator(event_type)
    except FileNotFoundError as err:
        raise PayloadValidationError(
            event_type, [f"inget schema på {_payload_schema_path(event_type)}"]
        ) from err
    errors: list[ValidationError] = sorted(validator.iter_errors(payload), key=str)
    if errors:
        raise PayloadValidationError(event_type, [e.message for e in errors])

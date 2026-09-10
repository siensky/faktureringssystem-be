"""Kontraktstest: validerar samma fixture-filer som TS-sidans
envelope.contract.test.ts, mot samma schemafil (packages/contracts/schemas/
envelope.schema.json). Går båda gröna betyder det att TS och Python ser
eventet på exakt samma sätt."""

import json
from pathlib import Path

import pytest

from documents.contracts import EnvelopeValidationError, assert_valid_envelope, is_valid_envelope

_FIXTURES_DIR = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "fixtures"


def _load_fixture(name: str) -> dict:
    with (_FIXTURES_DIR / name).open("r", encoding="utf-8") as f:
        return json.load(f)


def test_giltig_envelope_passerar_valideringen():
    valid = _load_fixture("valid-envelope.json")
    assert is_valid_envelope(valid) is True
    assert_valid_envelope(valid)  # kastar inte


def test_saknad_tenant_id_avvisas():
    invalid = _load_fixture("invalid-envelope-missing-tenant.json")
    assert is_valid_envelope(invalid) is False
    with pytest.raises(EnvelopeValidationError, match="tenantId"):
        assert_valid_envelope(invalid)


def test_ogiltigt_event_type_avvisas():
    invalid = _load_fixture("invalid-envelope-bad-event-type.json")
    assert is_valid_envelope(invalid) is False


def test_extra_falt_avvisas():
    valid = _load_fixture("valid-envelope.json")
    with_extra = {**valid, "unexpectedField": "should not be here"}
    assert is_valid_envelope(with_extra) is False

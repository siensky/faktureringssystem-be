"""verify_service_token speglar packages/shared/src/auth/service-tokens.ts:
algoritmen pinnas (HS256), iss/aud/token_type valideras, ett användar-token
(fel aud) avvisas."""

import time

import jwt
import pytest

from documents.service_auth import verify_service_token

_SECRET = "tjanste-hemlighet-minst-32-bytes-lang-0"


def _token(**overrides) -> str:
    claims = {
        "sub": "svc-documents",
        "scope": "documents:pdf:read billing:invoice:read",
        "token_type": "service",
        "iss": "faktura-auth",
        "aud": "internal",
        "iat": int(time.time()),
        "exp": int(time.time()) + 300,
    }
    claims.update(overrides)
    alg = overrides.pop("_alg", "HS256")
    return jwt.encode(claims, _SECRET, algorithm=alg)


def test_giltigt_tjanste_token_ger_client_id_och_scopes():
    client_id, scopes = verify_service_token(_token(), _SECRET)
    assert client_id == "svc-documents"
    assert "documents:pdf:read" in scopes


def test_fel_hemlighet_avvisas():
    with pytest.raises(ValueError, match="ogiltigt tjänste-token"):
        verify_service_token(_token(), "annan-hemlighet")


def test_fel_audience_avvisas():
    with pytest.raises(ValueError):
        verify_service_token(_token(aud="api"), _SECRET)


def test_fel_issuer_avvisas():
    with pytest.raises(ValueError):
        verify_service_token(_token(iss="någon-annan"), _SECRET)


def test_fel_token_type_avvisas():
    with pytest.raises(ValueError, match="fel token-typ"):
        verify_service_token(_token(token_type="access"), _SECRET)


def test_utganget_token_avvisas():
    with pytest.raises(ValueError):
        verify_service_token(_token(exp=int(time.time()) - 10), _SECRET)


def test_alg_none_avvisas():
    # jwt.encode med alg="none" ger ett osignerat token — verifieringen
    # pinnar HS256 och ska aldrig acceptera det (alg:none-attacken).
    unsigned = jwt.encode(
        {"sub": "x", "token_type": "service", "iss": "faktura-auth", "aud": "internal"},
        key=None,
        algorithm="none",
    )
    with pytest.raises(ValueError):
        verify_service_token(unsigned, _SECRET)

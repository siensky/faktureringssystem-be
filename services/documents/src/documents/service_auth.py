"""Verifiering av tjänste-token (M2M) på documents interna endpoints.
Python-motsvarigheten till packages/shared/src/auth/service-tokens.ts.

Samma tre oberoende kontroller som TS-sidan (architecture.md #22):
  - algoritmen PINNAS (HS256) — `alg` i token-headern litas aldrig på
  - `iss` och `aud` valideras (faktura-auth / internal)
  - `token_type` måste vara "service"

Documents har inga användar-endpoints och verifierar bara den här
token-klassen — den får därför aldrig JWT_USER_SECRET (planens Säkerhet #1).
"""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import HTTPException, Request

_ISSUER = "faktura-auth"
_AUDIENCE = "internal"
_TOKEN_TYPE = "service"


@dataclass(frozen=True)
class ServiceContext:
    client_id: str
    scopes: list[str]
    tenant_id: int | None


def verify_service_token(token: str, secret: str) -> tuple[str, list[str]]:
    """Returnerar (client_id, scopes) eller kastar ValueError."""
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            issuer=_ISSUER,
            audience=_AUDIENCE,
        )
    except jwt.InvalidTokenError as err:
        raise ValueError(f"ogiltigt tjänste-token: {err}") from err

    if payload.get("token_type") != _TOKEN_TYPE:
        raise ValueError("fel token-typ")
    sub = payload.get("sub")
    if not isinstance(sub, str):
        raise ValueError("token saknar sub")  # noqa: TRY004 — enhetlig "ogiltigt token"

    scope = payload.get("scope", "")
    scopes = scope.split() if isinstance(scope, str) else []
    return sub, scopes


def _tenant_id_from_header(request: Request) -> int | None:
    raw = request.headers.get("x-tenant-id")
    if raw is None:
        return None
    try:
        value = int(raw)
    except ValueError as err:
        raise HTTPException(status_code=400, detail="X-Tenant-Id måste vara ett heltal") from err
    if value <= 0:
        raise HTTPException(status_code=400, detail="X-Tenant-Id måste vara positivt")
    return value


def create_require_service(secret: str):
    """FastAPI-dependency-fabrik. `require_service(scope)` ger en dependency
    som kastar 401 vid ogiltig token och 403 vid fel scope (architecture.md
    #19) — samma skillnad som TS-sidans requireService."""

    def require_service(required_scope: str):
        async def dependency(request: Request) -> ServiceContext:
            header = request.headers.get("authorization", "")
            if not header.startswith("Bearer "):
                raise HTTPException(status_code=401, detail="Bearer-token saknas")
            try:
                client_id, scopes = verify_service_token(header[len("Bearer ") :].strip(), secret)
            except ValueError as err:
                raise HTTPException(status_code=401, detail=str(err)) from err
            if required_scope not in scopes:
                raise HTTPException(status_code=403, detail=f"Saknar scope: {required_scope}")
            return ServiceContext(
                client_id=client_id,
                scopes=scopes,
                tenant_id=_tenant_id_from_header(request),
            )

        return dependency

    return require_service


def require_tenant(ctx: ServiceContext) -> int:
    """För en handler som KRÄVER en tenant: 400 om X-Tenant-Id saknas —
    ett medvetet klientfel, inte ett 500 längre ner (architecture.md #21)."""
    if ctx.tenant_id is None:
        raise HTTPException(status_code=400, detail="X-Tenant-Id krävs för denna endpoint")
    return ctx.tenant_id

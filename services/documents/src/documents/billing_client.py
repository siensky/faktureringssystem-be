"""S2S-klient mot billing (snapshot) och auth (tjänste-token).

Tjänste-token hämtas via OAuth2 client_credentials från auth och cachas i
Redis tills strax före utgång — samma mönster som
packages/shared/src/auth/service-token-client.ts på TS-sidan. TTL på
tjänste-token är 5 minuter (architecture.md #18), så cachen sparar en
runda per event utan att hålla ett dött token.

Snapshoten hämtas ur billings interna endpoint. X-Tenant-Id sätts från
eventets tenantId (architecture.md #17 — en autentiserad tjänst får hävda
tenant); X-Correlation-Id förs vidare (architecture.md #5).
"""

from __future__ import annotations

from typing import Any

import httpx
import redis.asyncio as redis_asyncio

from .config import Settings

_CACHE_PREFIX = "svc-token:"
_REFRESH_MARGIN_SECONDS = 30


class BillingClient:
    def __init__(self, settings: Settings, redis: redis_asyncio.Redis) -> None:
        self._settings = settings
        self._redis = redis
        self._scope = " ".join(sorted(settings.documents_client_scopes))
        self._cache_key = f"{_CACHE_PREFIX}{settings.documents_client_id}:{self._scope}"

    async def _service_token(self) -> str:
        cached = await self._redis.get(self._cache_key)
        if cached:
            return cached.decode("utf-8") if isinstance(cached, bytes) else cached

        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                f"{self._settings.auth_base_url}/auth/token",
                json={
                    "grant_type": "client_credentials",
                    "client_id": self._settings.documents_client_id,
                    "client_secret": self._settings.documents_client_secret,
                    "scope": self._scope,
                },
            )
        if res.status_code != 200:
            raise RuntimeError(f"kunde inte hämta tjänste-token: {res.status_code}")
        body = res.json()
        token: str = body["access_token"]
        ttl = max(int(body.get("expires_in", 300)) - _REFRESH_MARGIN_SECONDS, 1)
        await self._redis.set(self._cache_key, token, ex=ttl)
        return token

    async def fetch_snapshot(
        self, *, invoice_id: int, tenant_id: int, correlation_id: str
    ) -> dict[str, Any]:
        token = await self._service_token()
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(
                f"{self._settings.billing_base_url}/internal/invoices/{invoice_id}/snapshot",
                headers={
                    "authorization": f"Bearer {token}",
                    "x-tenant-id": str(tenant_id),
                    "x-correlation-id": correlation_id,
                },
            )
        if res.status_code == 404:
            raise SnapshotNotFound(invoice_id)
        if res.status_code in (401, 403):
            # Fel scope, eller en avstängd/borttagen tenant. Ingen av dem
            # löser sig av att vänta — behandlas som permanent av
            # konsumenten (ack + larm), inte som ett transient fel.
            raise SnapshotAccessDenied(invoice_id, res.status_code)
        if res.status_code != 200:
            raise RuntimeError(f"snapshot {invoice_id}: billing svarade {res.status_code}")
        return res.json()


class SnapshotNotFound(RuntimeError):
    def __init__(self, invoice_id: int) -> None:
        self.invoice_id = invoice_id
        super().__init__(f"ingen snapshot för faktura {invoice_id}")


class SnapshotAccessDenied(RuntimeError):
    def __init__(self, invoice_id: int, status_code: int) -> None:
        self.invoice_id = invoice_id
        self.status_code = status_code
        super().__init__(f"snapshot {invoice_id}: billing nekade åtkomst ({status_code})")

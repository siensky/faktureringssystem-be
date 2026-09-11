"""Interna S2S-endpoints för documents.

GET /internal/documents/:invoiceId/url
    Ger en tidsbegränsad, signerad GET-URL till fakturans PDF. Portalen
    (fas 9) använder den; mejlet bär PDF:en som bilaga i stället, så ingen
    bärartoken hamnar i en inkorg (domain.md #19).

    Kräver tjänste-token med scope `documents:pdf:read` och X-Tenant-Id
    (architecture.md #16–17). 404 — inte 403 — om dokumentet inte finns
    för tenanten (code-style.md #14).
"""

from __future__ import annotations

import time
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from . import repository
from .config import Settings
from .s3 import S3Store
from .service_auth import ServiceContext, require_tenant

PDF_SCOPE = "documents:pdf:read"


def create_documents_router(
    pool_getter, s3_getter, settings: Settings, require_service
) -> APIRouter:
    router = APIRouter()
    pdf_guard = require_service(PDF_SCOPE)

    @router.get("/internal/documents/{invoice_id}/url")
    async def get_pdf_url(
        invoice_id: int,
        ctx: ServiceContext = Depends(pdf_guard),
    ) -> dict[str, Any]:
        tenant_id = require_tenant(ctx)
        pool: asyncpg.Pool = pool_getter()

        async with pool.acquire() as conn:
            doc = await repository.find_document(conn, tenant_id=tenant_id, invoice_id=invoice_id)
        if doc is None:
            raise HTTPException(status_code=404, detail="Inget dokument för fakturan")

        s3: S3Store = s3_getter()
        ttl = settings.pdf_url_ttl_seconds
        url = await s3.presigned_get_url(doc["storage_key"], ttl)
        return {
            "invoiceId": invoice_id,
            "documentType": doc["document_type"],
            "url": url,
            "expiresAt": int(time.time()) + ttl,
        }

    return router

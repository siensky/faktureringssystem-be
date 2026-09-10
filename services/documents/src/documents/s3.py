"""S3-lagring via boto3 (MinIO lokalt/CI). boto3 är synkront, så varje
anrop läggs på en trådpool med asyncio.to_thread för att inte blockera
event-loopen.

S3-nyckeln härleds ur (tenant_id, invoice_id, document_type) — samma tre
värden som UNIQUE-nyckeln i `documents` — så samma event två gånger skriver
samma objekt till samma nyckel (planens idempotensavsnitt #5). Ingen
`document-1.pdf` / `document-2.pdf`.
"""

from __future__ import annotations

import asyncio

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from .config import Settings


def storage_key(tenant_id: int, invoice_id: int, document_type: str) -> str:
    return f"{tenant_id}/invoices/{invoice_id}/{document_type}.pdf"


def _client(settings: Settings, *, public: bool = False):
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_public_endpoint if public else settings.s3_endpoint,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        # MinIO svarar inte på virtual-host-style (bucket.host) — tvinga
        # path-style, annars pekar signerade URL:er på ett värdnamn som
        # inte finns.
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


async def ensure_bucket(settings: Settings) -> None:
    """Skapar bucketen om den saknas. MinIO auto-skapar inte."""

    def _run() -> None:
        client = _client(settings)
        try:
            client.head_bucket(Bucket=settings.s3_bucket)
        except ClientError as err:
            code = err.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchBucket", "NoSuchKey"):
                client.create_bucket(Bucket=settings.s3_bucket)
            else:
                raise

    await asyncio.to_thread(_run)


async def put_pdf(settings: Settings, key: str, data: bytes) -> None:
    def _run() -> None:
        _client(settings).put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=data,
            ContentType="application/pdf",
        )

    await asyncio.to_thread(_run)


async def get_pdf(settings: Settings, key: str) -> bytes:
    def _run() -> bytes:
        obj = _client(settings).get_object(Bucket=settings.s3_bucket, Key=key)
        return obj["Body"].read()

    return await asyncio.to_thread(_run)


async def object_exists(settings: Settings, key: str) -> bool:
    def _run() -> bool:
        try:
            _client(settings).head_object(Bucket=settings.s3_bucket, Key=key)
            return True
        except ClientError:
            return False

    return await asyncio.to_thread(_run)


def presigned_get_url(settings: Settings, key: str, ttl_seconds: int) -> str:
    """Tidsbegränsad GET-URL mot det PUBLIKA endpointet. Bärartoken —
    loggas aldrig (domain.md #19)."""
    return _client(settings, public=True).generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=ttl_seconds,
    )

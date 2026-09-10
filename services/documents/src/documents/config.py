"""Env-validering som kraschar tidigt vid saknad config — samma princip som
packages/shared/src/config/index.ts på TS-sidan (fas 0, se PLAN.md).
code-style.md #26/#28: konfiguration läses en gång vid uppstart och
valideras, ingen os.environ utspridd i affärslogiken.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


class MissingEnvError(RuntimeError):
    def __init__(self, missing_keys: list[str]) -> None:
        self.missing_keys = missing_keys
        super().__init__(f"Saknade miljövariabler: {', '.join(missing_keys)}")


@dataclass(frozen=True)
class Settings:
    service_name: str
    port: int
    rabbitmq_url: str
    redis_url: str
    database_url: str
    cors_origins: list[str]
    log_level: str

    # Verifierar tjänste-JWT (aud: internal). Documents har INGA
    # användar-endpoints och får därför ALDRIG JWT_USER_SECRET (planens
    # Säkerhet-avsnitt, punkt 1).
    jwt_service_secret: str

    # S3 / MinIO. s3_endpoint används internt (put/head); s3_public_endpoint
    # för signerade URL:er som ska nås av en webbläsare (fas 9-portalen) —
    # `minio:9000` är inte nåbart utanför Docker-nätet.
    s3_endpoint: str
    s3_public_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_access_key_id: str
    s3_secret_access_key: str
    pdf_url_ttl_seconds: int

    # SMTP (Mailpit lokalt/CI).
    smtp_host: str
    smtp_port: int
    email_from: str

    # HMAC-hemlighet för POST /webhooks/email-status. Signaturen räknas över
    # RÅ body (domain.md #25, planens Säkerhet: Webhooks).
    email_webhook_secret: str

    # S2S mot billing (snapshot) och auth (tjänste-token).
    billing_base_url: str
    auth_base_url: str
    documents_client_id: str
    documents_client_secret: str
    documents_client_scopes: list[str] = field(default_factory=list)


_REQUIRED = [
    "RABBITMQ_URL",
    "REDIS_URL",
    "DATABASE_URL",
    "JWT_SERVICE_SECRET",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "SMTP_HOST",
    "EMAIL_FROM",
    "EMAIL_WEBHOOK_SECRET",
    "BILLING_BASE_URL",
    "AUTH_BASE_URL",
    "DOCUMENTS_CLIENT_ID",
    "DOCUMENTS_CLIENT_SECRET",
]

_DEFAULT_SCOPES = "billing:invoice:read billing:company:read billing:customer:read"


def load_settings(env: dict[str, str] | None = None) -> Settings:
    source = env if env is not None else os.environ

    missing = [key for key in _REQUIRED if not source.get(key)]
    if missing:
        raise MissingEnvError(missing)

    cors_origin = source.get("CORS_ORIGIN", "http://localhost:5173")
    s3_endpoint = source["S3_ENDPOINT"]

    return Settings(
        service_name="documents",
        port=int(source.get("PORT", "4004")),
        rabbitmq_url=source["RABBITMQ_URL"],
        redis_url=source["REDIS_URL"],
        database_url=source["DATABASE_URL"],
        cors_origins=[origin.strip() for origin in cors_origin.split(",")],
        log_level=source.get("LOG_LEVEL", "info"),
        jwt_service_secret=source["JWT_SERVICE_SECRET"],
        s3_endpoint=s3_endpoint,
        s3_public_endpoint=source.get("S3_PUBLIC_ENDPOINT", s3_endpoint),
        s3_region=source.get("S3_REGION", "us-east-1"),
        s3_bucket=source["S3_BUCKET"],
        s3_access_key_id=source["S3_ACCESS_KEY_ID"],
        s3_secret_access_key=source["S3_SECRET_ACCESS_KEY"],
        pdf_url_ttl_seconds=int(source.get("PDF_URL_TTL_SECONDS", "900")),
        smtp_host=source["SMTP_HOST"],
        smtp_port=int(source.get("SMTP_PORT", "1025")),
        email_from=source["EMAIL_FROM"],
        email_webhook_secret=source["EMAIL_WEBHOOK_SECRET"],
        billing_base_url=source["BILLING_BASE_URL"].rstrip("/"),
        auth_base_url=source["AUTH_BASE_URL"].rstrip("/"),
        documents_client_id=source["DOCUMENTS_CLIENT_ID"],
        documents_client_secret=source["DOCUMENTS_CLIENT_SECRET"],
        documents_client_scopes=source.get("DOCUMENTS_CLIENT_SCOPES", _DEFAULT_SCOPES).split(),
    )

import pytest

from documents.config import MissingEnvError, load_settings

_FULL_ENV = {
    "RABBITMQ_URL": "amqp://localhost",
    "REDIS_URL": "redis://localhost",
    "DATABASE_URL": "postgresql://localhost/db",
    "JWT_SERVICE_SECRET": "svc-secret",
    "S3_ENDPOINT": "http://minio:9000",
    "S3_BUCKET": "invoices",
    "S3_ACCESS_KEY_ID": "key",
    "S3_SECRET_ACCESS_KEY": "secret",
    "SMTP_HOST": "mailpit",
    "EMAIL_FROM": "fakturor@faktura.test",
    "EMAIL_WEBHOOK_SECRET": "wh-secret",
    "BILLING_BASE_URL": "http://billing:4002/",
    "AUTH_BASE_URL": "http://auth:4001/",
    "DOCUMENTS_CLIENT_ID": "svc-documents",
    "DOCUMENTS_CLIENT_SECRET": "client-secret",
}


def test_load_settings_med_alla_nycklar():
    settings = load_settings(dict(_FULL_ENV))
    assert settings.rabbitmq_url == "amqp://localhost"
    assert settings.port == 4004  # default
    # trailing slash trimmas så S2S-URL:er inte blir dubbla //
    assert settings.billing_base_url == "http://billing:4002"
    assert settings.auth_base_url == "http://auth:4001"
    # publikt S3-endpoint faller tillbaka på det interna om inte satt
    assert settings.s3_public_endpoint == "http://minio:9000"
    assert settings.documents_client_scopes == [
        "billing:invoice:read",
        "billing:company:read",
        "billing:customer:read",
    ]


@pytest.mark.parametrize(
    "missing",
    [
        "DATABASE_URL",
        "JWT_SERVICE_SECRET",
        "S3_ENDPOINT",
        "EMAIL_WEBHOOK_SECRET",
        "BILLING_BASE_URL",
        "DOCUMENTS_CLIENT_SECRET",
    ],
)
def test_load_settings_kastar_pa_saknad_nyckel(missing: str):
    env = dict(_FULL_ENV)
    del env[missing]
    with pytest.raises(MissingEnvError) as exc_info:
        load_settings(env)
    assert missing in exc_info.value.missing_keys


def test_load_settings_tom_strang_raknas_som_saknad():
    env = dict(_FULL_ENV)
    env["REDIS_URL"] = ""
    with pytest.raises(MissingEnvError):
        load_settings(env)


def test_s3_public_endpoint_kan_overridas():
    env = dict(_FULL_ENV)
    env["S3_PUBLIC_ENDPOINT"] = "http://localhost:9000"
    settings = load_settings(env)
    assert settings.s3_public_endpoint == "http://localhost:9000"
    assert settings.s3_endpoint == "http://minio:9000"


def test_cors_origin_splittas_pa_komma():
    env = dict(_FULL_ENV)
    env["CORS_ORIGIN"] = "http://a.example, http://b.example"
    settings = load_settings(env)
    assert settings.cors_origins == ["http://a.example", "http://b.example"]

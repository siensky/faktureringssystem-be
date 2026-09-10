import pytest

from documents.config import MissingEnvError, load_settings


def test_load_settings_med_alla_nycklar():
    settings = load_settings({"RABBITMQ_URL": "amqp://localhost", "REDIS_URL": "redis://localhost"})
    assert settings.rabbitmq_url == "amqp://localhost"
    assert settings.redis_url == "redis://localhost"
    assert settings.port == 4004  # default


def test_load_settings_kastar_pa_saknad_nyckel():
    with pytest.raises(MissingEnvError) as exc_info:
        load_settings({"RABBITMQ_URL": "amqp://localhost"})
    assert "REDIS_URL" in exc_info.value.missing_keys


def test_load_settings_tom_strang_raknas_som_saknad():
    with pytest.raises(MissingEnvError):
        load_settings({"RABBITMQ_URL": "", "REDIS_URL": "redis://localhost"})


def test_cors_origin_splittas_pa_komma():
    settings = load_settings(
        {
            "RABBITMQ_URL": "amqp://localhost",
            "REDIS_URL": "redis://localhost",
            "CORS_ORIGIN": "http://a.example, http://b.example",
        }
    )
    assert settings.cors_origins == ["http://a.example", "http://b.example"]

"""Env-validering som kraschar tidigt vid saknad config — samma princip som
packages/shared/src/config/index.ts på TS-sidan (fas 0, se PLAN.md).
code-style.md #26: konfiguration läses en gång vid uppstart och valideras,
ingen os.environ utspridd i affärslogiken.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


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
    cors_origins: list[str]
    log_level: str


def load_settings(env: dict[str, str] | None = None) -> Settings:
    source = env if env is not None else os.environ

    required = ["RABBITMQ_URL", "REDIS_URL"]
    missing = [key for key in required if not source.get(key)]
    if missing:
        raise MissingEnvError(missing)

    cors_origin = source.get("CORS_ORIGIN", "http://localhost:5173")

    return Settings(
        service_name="documents",
        port=int(source.get("PORT", "4004")),
        rabbitmq_url=source["RABBITMQ_URL"],
        redis_url=source["REDIS_URL"],
        cors_origins=[origin.strip() for origin in cors_origin.split(",")],
        log_level=source.get("LOG_LEVEL", "info"),
    )

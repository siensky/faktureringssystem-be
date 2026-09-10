"""documents-tjänsten. Fas 0: bara fundamentet — health, RabbitMQ-anslutning
med system-ping, och skyddsmekanismerna (CORS, säkerhetsheaders, body-limit)
som all affärslogik i senare faser (PDF-rendering, e-postutskick) byggs
ovanpå. Ingen affärslogik hör hemma här — bara bootstrap, samma princip som
för de tre TS-tjänsterna (code-style.md #2).
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

import redis.asyncio as redis_asyncio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import MissingEnvError, load_settings
from .logging import configure_logging, get_logger
from .middleware import BodySizeLimitMiddleware, SecurityHeadersMiddleware
from .rabbitmq import RabbitConnection, connect_rabbitmq, start_system_ping

MAX_BODY_BYTES = 256 * 1024  # 256 KB, samma standard som TS-tjänsterna

try:
    settings = load_settings()
except MissingEnvError as error:
    # Kraschar direkt vid importtillfället (uvicorn laddar main:app vid
    # uppstart) — hellre ett tydligt fel i loggen vid start än en tjänst
    # som startar och faller på första requesten (code-style.md #26).
    raise SystemExit(str(error)) from error

configure_logging(settings.service_name, settings.log_level)
logger = get_logger()

_state: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    rabbit: RabbitConnection = await connect_rabbitmq(settings.rabbitmq_url)
    redis_client = redis_asyncio.from_url(settings.redis_url)

    ping_state = await start_system_ping(
        rabbit.channel,
        settings.service_name,
        on_ping=lambda msg: logger.info("mottog system.ping", **{"from": msg["service"]}),
    )

    _state["rabbit"] = rabbit
    _state["redis"] = redis_client
    _state["ping_state"] = ping_state

    logger.info("documents lyssnar", port=settings.port)
    yield

    ping_state.stop()
    await rabbit.close()
    await redis_client.aclose()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_BODY_BYTES)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    # Samma publika felform som BaseError.toPublicError() i packages/shared
    # (code-style.md #13): inga interna detaljer i svaret, stack traces går
    # bara till loggen.
    logger.error("unhandled error", error=str(exc), exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"success": False, "code": 500, "message": "Internal server Error"},
    )


@app.get("/health/live")
async def health_live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready() -> JSONResponse:
    failed: list[str] = []

    rabbit: RabbitConnection | None = _state.get("rabbit")
    if rabbit is None or not rabbit.is_open:
        failed.append("rabbitmq")

    redis_client = _state.get("redis")
    try:
        if redis_client is None:
            raise RuntimeError("redis not initialised")
        await redis_client.ping()
    except Exception as error:  # noqa: BLE001 — health-check ska aldrig krascha, alla fel räknas som unhealthy
        logger.warning("redis readiness check misslyckades", error=str(error))
        failed.append("redis")

    if failed:
        return JSONResponse(status_code=503, content={"status": "unhealthy", "failed": failed})
    return JSONResponse(status_code=200, content={"status": "ok"})


@app.get("/internal/debug/pings-seen")
async def pings_seen() -> dict[str, list[str]]:
    # Tillfällig debug-endpoint för fas 0 — samma som i de tre TS-tjänsterna,
    # tas bort när riktiga affärsevent finns att verifiera mot i stället.
    ping_state = _state.get("ping_state")
    return {"seen": sorted(ping_state.seen) if ping_state else []}

"""BodySizeLimitMiddleware ska stoppa för stora bodies även när
Content-Length saknas (chunked) — det var hela poängen med att byta från
den Content-Length-baserade BaseHTTPMiddleware-varianten."""

import httpx
import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from documents.middleware import BodySizeLimitMiddleware

MAX = 1024


async def _echo_len(request: Request) -> PlainTextResponse:
    body = await request.body()
    return PlainTextResponse(str(len(body)))


def _app() -> BodySizeLimitMiddleware:
    inner = Starlette(routes=[Route("/", _echo_len, methods=["POST"])])
    return BodySizeLimitMiddleware(inner, max_bytes=MAX)


async def _post(app, body: bytes, headers: dict | None = None) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        return await client.post("/", content=body, headers=headers or {})


@pytest.mark.asyncio
async def test_liten_body_slapps_igenom():
    resp = await _post(_app(), b"x" * (MAX - 1))
    assert resp.status_code == 200
    assert resp.text == str(MAX - 1)


@pytest.mark.asyncio
async def test_for_stor_body_med_content_length_avvisas():
    resp = await _post(_app(), b"x" * (MAX + 500))
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_for_stor_body_utan_content_length_avvisas():
    # En async-generator-body får httpx att skicka chunked utan
    # Content-Length — det fallet som den gamla middleware-varianten missade.
    async def chunks():
        for _ in range(4):
            yield b"x" * 500  # 2000 bytes totalt > MAX

    transport = httpx.ASGITransport(app=_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        resp = await client.post("/", content=chunks())
    assert "content-length" not in {k.lower() for k in resp.request.headers}
    assert resp.status_code == 413

"""Transportnära middleware — motsvarigheten till Fastifys bodyLimit och
@fastify/helmet på TS-sidan. Egen modul utan sidoeffekter vid import, så
den kan testas utan att dra in hela bootstrap-kedjan i main.py.
"""

from __future__ import annotations

from starlette.datastructures import Headers
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class BodySizeLimitMiddleware:
    """Bufferar in bodyn (upp till max_bytes + 1) INNAN requesten når appen,
    och svarar 413 direkt om taket passeras. Kollar även Content-Length som
    en snabbväg. Den gamla BaseHTTPMiddleware-varianten kollade BARA
    Content-Length, vilket en chunked request utan den headern kringgick
    helt.

    Att buffra hela bodyn är oproblematiskt här: API:et tar bara små
    JSON-bodies, och appen (Pydantic / request.json()) skulle buffra in
    exakt samma bytes ändå. Vinsten är att minnet är hårt begränsat och att
    en för stor body avvisas rent, utan att appen ens startar.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        content_length = Headers(scope=scope).get("content-length")
        if (
            content_length is not None
            and content_length.isdigit()
            and int(content_length) > self.max_bytes
        ):
            await self._reject(send)
            return

        buffered: list[Message] = []
        total = 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                buffered.append(message)
                break
            total += len(message.get("body", b""))
            if total > self.max_bytes:
                await self._reject(send)
                return
            buffered.append(message)
            if not message.get("more_body", False):
                break

        iterator = iter(buffered)

        async def replay() -> Message:
            try:
                return next(iterator)
            except StopIteration:
                # Bodyn är slut men appen frågar efter mer — mata den ett
                # tomt sista chunk i stället för att hänga.
                return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, replay, send)

    @staticmethod
    async def _reject(send: Send) -> None:
        body = b'{"success":false,"code":413,"message":"Request body too large"}'
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": body})


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Motsvarighet till @fastify/helmet i TS-tjänsterna — grundläggande
    säkerhetsheaders på varje svar."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

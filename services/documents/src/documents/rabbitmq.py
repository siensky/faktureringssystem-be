"""RabbitMQ-anslutning och system-ping — Python-motsvarigheten till
packages/shared/src/rabbitmq och src/ping på TS-sidan. Samma mekanism:
ett fanout-exchange "system.ping" utanför affärsevent-envelopen, eftersom
ett ping saknar tenant och inte är en affärshändelse.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import aio_pika
from aio_pika.abc import AbstractChannel, AbstractRobustConnection

PING_EXCHANGE = "system.ping"
PING_INTERVAL_SECONDS = 5

# asyncio.create_task() håller bara en SVAG referens till tasken om inget
# annat gör det — den kan då plockas bort av GC mitt i väntan. Denna
# modulnivå-mängden håller en stark referens så länge processen lever.
_background_tasks: set[asyncio.Task] = set()


class RabbitConnection:
    def __init__(self, connection: AbstractRobustConnection, channel: AbstractChannel) -> None:
        self.connection = connection
        self.channel = channel

    async def close(self) -> None:
        await self.channel.close()
        await self.connection.close()

    @property
    def is_open(self) -> bool:
        return not self.connection.is_closed


async def connect_rabbitmq(url: str) -> RabbitConnection:
    connection = await aio_pika.connect_robust(url)
    channel = await connection.channel()
    return RabbitConnection(connection, channel)


class PingState:
    def __init__(self) -> None:
        self.seen: set[str] = set()


async def start_system_ping(
    channel: AbstractChannel,
    service_name: str,
    on_ping: Callable[[dict[str, Any]], None] | None = None,
) -> PingState:
    exchange = await channel.declare_exchange(
        PING_EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=False
    )
    # Explicit könamn, inte ett klientgenererat — se motsvarande kommentar i
    # packages/shared/src/ping/index.ts (TS-sidan) för varför.
    queue_name = f"system.ping.{service_name}"
    queue = await channel.declare_queue(queue_name, exclusive=True, auto_delete=True)
    await queue.bind(exchange)

    state = PingState()

    async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
        async with message.process():
            body = json.loads(message.body.decode("utf-8"))
            state.seen.add(body["service"])
            if on_ping:
                on_ping(body)

    await queue.consume(handle)

    async def publish_ping() -> None:
        ping = {"service": service_name, "occurredAt": datetime.now(UTC).isoformat()}
        await exchange.publish(
            aio_pika.Message(
                body=json.dumps(ping).encode("utf-8"), content_type="application/json"
            ),
            routing_key="",
        )

    async def publish_ping_periodically() -> None:
        # Se motsvarande kommentar i packages/shared/src/ping/index.ts
        # (TS-sidan): ett enda ping vid uppstart räcker inte eftersom fyra
        # tjänster startar parallellt och ett fanout-meddelande som kommer
        # innan en annan tjänsts kö är bunden går förlorat för den.
        while True:
            await asyncio.sleep(PING_INTERVAL_SECONDS)
            await publish_ping()

    await publish_ping()
    task = asyncio.create_task(publish_ping_periodically())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return state

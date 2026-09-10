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
from aio_pika.abc import AbstractChannel, AbstractConnection, AbstractExchange

PING_EXCHANGE = "system.ping"
PING_INTERVAL_SECONDS = 5

# Det delade affärsevent-exchanget. Deklareras EN gång av
# infra/rabbitmq/init.sh (durable topic). documents-kontot har medvetet
# inte 'configure' på det (se init.sh), så vi deklarerar det aldrig —
# ensure=False ger ett Exchange-objekt utan passiv deklaration, bara för
# att kunna publicera och binda mot namnet.
EVENTS_EXCHANGE = "events"


async def events_exchange(channel: AbstractChannel) -> AbstractExchange:
    return await channel.get_exchange(EVENTS_EXCHANGE, ensure=False)


# asyncio.create_task() håller bara en SVAG referens till tasken om inget
# annat gör det — den kan då plockas bort av GC mitt i väntan. Denna
# modulnivå-mängden håller en stark referens så länge processen lever.
_background_tasks: set[asyncio.Task] = set()


class RabbitConnection:
    def __init__(self, connection: AbstractConnection, channel: AbstractChannel) -> None:
        self.connection = connection
        self.channel = channel
        self._healthy = True
        # Vanlig (icke-robust) anslutning, precis som amqplib.connect() på
        # TS-sidan: den återansluter INTE automatiskt, så en tappad broker
        # syns direkt i is_open i stället för att döljas av en robust
        # klients tysta reconnect-loop. /health/ready ska rapportera
        # sanningen om beroenden.
        connection.close_callbacks.add(self._on_close)
        channel.close_callbacks.add(self._on_close)

    def _on_close(self, *_args: object) -> None:
        self._healthy = False

    async def close(self) -> None:
        self._healthy = False
        await self.channel.close()
        await self.connection.close()

    @property
    def is_open(self) -> bool:
        return self._healthy and not self.connection.is_closed


async def connect_rabbitmq(url: str) -> RabbitConnection:
    connection = await aio_pika.connect(url)
    channel = await connection.channel()
    return RabbitConnection(connection, channel)


class PingState:
    def __init__(self) -> None:
        self.seen: set[str] = set()
        self.task: asyncio.Task | None = None

    def stop(self) -> None:
        """Stoppar den periodiska ping-timern. Anropas vid graceful shutdown."""
        if self.task is not None:
            self.task.cancel()


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
            try:
                await publish_ping()
            except Exception:  # noqa: BLE001
                # Kanalen kan ha stängts (RabbitMQ nere). Ett fas-0-ping som
                # inte går fram är ofarligt — sluta försöka, /health/ready
                # rapporterar problemet.
                return

    await publish_ping()
    task = asyncio.create_task(publish_ping_periodically())
    state.task = task
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return state

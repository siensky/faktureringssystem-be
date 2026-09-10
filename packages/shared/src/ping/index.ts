// Fas 0-beviset att alla fyra tjänster faktiskt pratar med varandra över
// RabbitMQ, innan någon affärslogik finns. Detta är INTE ett affärsevent —
// det använder inte packages/contracts envelope (som kräver tenantId) utan
// ett eget litet fanout-exchange. All logik ligger här, delad, i stället
// för kopierad i auth/billing/payments (code-style.md #25).

import type { Channel } from "amqplib";

export const PING_EXCHANGE = "system.ping";
const PING_INTERVAL_MS = 5000;

export interface PingMessage {
  service: string;
  occurredAt: string;
}

export interface PingState {
  /** Namnen på tjänster vi har sett minst ett ping ifrån, inklusive oss själva. */
  seen: Set<string>;
  /** Stoppar den periodiska ping-timern. Anropas vid graceful shutdown. */
  stop(): void;
}

/**
 * Ansluter till system.ping-exchanget, börjar lyssna, och publicerar sedan
 * ett eget ping. Returnerar ett state-objekt vars `seen`-mängd fylls på
 * allteftersom fler pling kommer in — poll den från en debug-endpoint för
 * att bevisa att bussen faktiskt rör sig.
 */
export async function startSystemPing(
  channel: Channel,
  serviceName: string,
  onPing?: (message: PingMessage) => void,
): Promise<PingState> {
  await channel.assertExchange(PING_EXCHANGE, "fanout", { durable: false });
  // Explicit, förutsägbart könamn i stället för ett serverautogenererat
  // (tomt namn) — amqplib/Node namnger de "amq.gen-...", aio-pika/Python
  // "amq_...", olika mönster per klientbibliotek, vilket gör dem opraktiska
  // att uttrycka i en RabbitMQ-permission-regex. Ett namn under
  // "system.ping.<tjänst>" gör permissions i infra/rabbitmq/init.sh enkla
  // och samma för båda språken.
  const queueName = `system.ping.${serviceName}`;
  const { queue } = await channel.assertQueue(queueName, { exclusive: true, autoDelete: true });
  await channel.bindQueue(queue, PING_EXCHANGE, "");

  const state: PingState = { seen: new Set(), stop: () => {} };

  channel.consume(queue, (msg) => {
    if (!msg) return;
    const body = JSON.parse(msg.content.toString("utf8")) as PingMessage;
    state.seen.add(body.service);
    onPing?.(body);
    channel.ack(msg);
  });

  const publishPing = () => {
    try {
      const ping: PingMessage = { service: serviceName, occurredAt: new Date().toISOString() };
      channel.publish(PING_EXCHANGE, "", Buffer.from(JSON.stringify(ping)), {
        contentType: "application/json",
      });
    } catch {
      // channel.publish() kastar synkront om kanalen stängts (RabbitMQ
      // nere). Anropet sker från setInterval utan await, så ett ohanterat
      // fel här dödar hela processen. Ett fas-0-ping som inte går fram är
      // ofarligt — sluta försöka och låt /health/ready rapportera problemet.
      state.stop();
    }
  };

  // Ett enda ping vid uppstart räcker inte: fyra tjänster startar parallellt
  // i docker-compose, och ett fanout-meddelande som publiceras innan en
  // annan tjänsts kö hunnit bindas går bara förlorat för den — RabbitMQ
  // levererar aldrig i efterhand. Ett upprepat ping var 5:e sekund gör att
  // /internal/debug/pings-seen konvergerar mot alla fyra oavsett
  // startordning, i stället för att bero på ett lyckträff i timing.
  publishPing();
  const timer = setInterval(publishPing, PING_INTERVAL_MS);
  timer.unref();
  state.stop = () => clearInterval(timer);

  return state;
}

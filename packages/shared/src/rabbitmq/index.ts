// Anslutning till RabbitMQ och tunna publish/consume-hjälpare. Detta är
// transportlagret — outbox-mönstret (event_outbox, at-least-once, dedup i
// processed_events) byggs ovanpå detta från fas 1 och framåt. I fas 0 finns
// bara ett system-ping som bevisar att bussen fungerar; den använder INTE
// den affärsevent-envelope som packages/contracts definierar, eftersom ett
// ping inte är en affärshändelse och saknar tenant (se architecture.md).

import amqplib, {
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";

export interface RabbitConnection {
  connection: ChannelModel;
  channel: Channel;
  /**
   * Confirm-kanal: `publish` returnerar först ett svar när brokern har
   * bekräftat (eller nack:at) meddelandet. Outbox-publishern MÅSTE använda
   * den här — en vanlig kanal är fire-and-forget, och en broker som tar
   * emot TCP men tappar meddelandet ger tyst eventförlust.
   */
  confirmChannel: ConfirmChannel;
  /**
   * `false` så fort brokern stängt anslutningen eller kanalen, eller ett
   * anslutningsfel inträffat. `/health/ready` läser den här — amqplib har
   * inget pålitligt synkront "är den öppen?"-API, men den skickar `close`-
   * och `error`-event, och det är dem vi speglar hit.
   */
  isHealthy(): boolean;
  close(): Promise<void>;
}

/** Publicerar på confirm-kanalen och väntar på brokerns bekräftelse. */
export function publishConfirmed(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  content: Buffer,
  options: Parameters<ConfirmChannel["publish"]>[3] = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    channel.publish(exchange, routingKey, content, options, (err) => {
      if (err) reject(err instanceof Error ? err : new Error("Broker nack:ade meddelandet"));
      else resolve();
    });
  });
}

export async function connectRabbitMQ(url: string): Promise<RabbitConnection> {
  const connection = await amqplib.connect(url);
  const channel = await connection.createChannel();
  const confirmChannel = await connection.createConfirmChannel();

  let healthy = true;
  const markUnhealthy = () => {
    healthy = false;
  };
  connection.on("close", markUnhealthy);
  connection.on("error", markUnhealthy);
  channel.on("close", markUnhealthy);
  channel.on("error", markUnhealthy);
  confirmChannel.on("close", markUnhealthy);
  confirmChannel.on("error", markUnhealthy);

  return {
    connection,
    channel,
    confirmChannel,
    isHealthy: () => healthy,
    async close() {
      healthy = false;
      await channel.close();
      await confirmChannel.close();
      await connection.close();
    },
  };
}

/** Publicerar ett JSON-serialiserbart meddelande på ett topic-exchange. */
export async function publishJson(
  channel: Channel,
  exchange: string,
  routingKey: string,
  message: unknown,
): Promise<void> {
  channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)), {
    contentType: "application/json",
    persistent: true,
  });
}

/**
 * Fas 7: passiv koll av en kös meddelandeantal (queue.declare med
 * passive=true) — t.ex. events.dlq:s djup för GET /internal/ops/alerts.
 * Kräver bara "configure"-behörighet på just den kön (infra/rabbitmq/
 * init.sh), inte "read" — den KONSUMERAR aldrig.
 *
 * Egen, kortlivad kanal: brokern STÄNGER kanalen om kön saknas eller
 * behörighet nekas (ett AMQP-kanalfel, inte bara ett avvisat anrop) — att
 * göra detta på den delade huvudkanalen (ping/publish) skulle då riva ner
 * OBESLÄKTAD funktionalitet som råkar dela den kanalen.
 */
export async function checkQueueDepth(connection: ChannelModel, queue: string): Promise<number> {
  const channel = await connection.createChannel();
  try {
    const { messageCount } = await channel.checkQueue(queue);
    return messageCount;
  } finally {
    // Kan i sig kasta om brokern redan stängt kanalen (t.ex. just det fel
    // vi försöker rapportera) — svälj det, men maskera aldrig det
    // ursprungliga felet från checkQueue.
    await channel.close().catch(() => {});
  }
}

export type JsonMessageHandler = (message: unknown, raw: ConsumeMessage) => Promise<void>;

/**
 * Konsumerar JSON-meddelanden från en kö. Handlern ackar vid lyckat utfall
 * och nackar (utan requeue) vid fel — permanenta fel ska inte loopa
 * oändligt på samma meddelande. Retry/backoff/dead-letter för riktiga
 * affärshändelser byggs i outbox-publishern (planens idempotensavsnitt #1),
 * inte här.
 */
export function consumeJson(
  channel: Channel,
  queue: string,
  handler: JsonMessageHandler,
  onError?: (error: unknown, raw: ConsumeMessage) => void,
): void {
  channel.consume(queue, (msg) => {
    if (!msg) return;
    const body = JSON.parse(msg.content.toString("utf8"));
    handler(body, msg)
      .then(() => channel.ack(msg))
      .catch((error) => {
        // code-style.md #15: svälj aldrig ett fel. Ingen logger-referens
        // finns i detta lager, så anroparen (som har sin service-logger)
        // får chansen att logga innan meddelandet nackas.
        onError?.(error, msg);
        channel.nack(msg, false, false);
      });
  });
}

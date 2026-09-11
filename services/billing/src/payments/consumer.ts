// RabbitMQ-konsument för payment.matched/payment.partial (från payments).
//
// EGEN kö (billing.payments.events), inte fler routing keys på den
// befintliga billing.events: två separat REGISTRERADE konsumenter på
// SAMMA kö skulle få RabbitMQ att round-robina meddelanden mellan dem
// oavsett routing key, oberoende av deliveries/consumer.ts. Se
// infra/rabbitmq/init.sh, som förhandsdeklarerar och binder den här kön
// — en medveten avvikelse från fas 5-planens ursprungliga text (som
// beskrev en delad kö), granskad och dokumenterad i PR-beskrivningen.
//
// Felhantering: identisk med deliveries/consumer.ts (samma
// x-attempts/republish-kanal/MAX_ATTEMPTS-mönster) — se den filens
// moduldoc för det fulla resonemanget.

import {
  EnvelopeValidationError,
  PayloadValidationError,
  type PaymentMatchedPayload,
  type PaymentPartialPayload,
  assertValidEnvelope,
  assertValidPayload,
} from "@faktura/contracts";
import type { Logger, RabbitConnection } from "@faktura/shared";
import type { Channel, ConsumeMessage } from "amqplib";
import type { PaymentApplyService } from "./service";

const EXCHANGE = "events";
const QUEUE = "billing.payments.events";
const ROUTING_KEYS = ["payment.matched", "payment.partial"];
const REQUEUE_DELAY_MS = 1000;
const ATTEMPTS_HEADER = "x-attempts";
const MAX_ATTEMPTS = 3;
// Måste vara IDENTISKA med infra/rabbitmq/init.sh:s förhandsdeklaration —
// RabbitMQ ger PRECONDITION_FAILED om en redeklaration har andra
// argument.
const QUEUE_ARGUMENTS = { "x-dead-letter-exchange": "events.dlx" };

export interface PaymentConsumer {
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startPaymentConsumer(opts: {
  rabbit: RabbitConnection;
  service: PaymentApplyService;
  logger: Logger;
}): Promise<PaymentConsumer> {
  const { rabbit, service, logger } = opts;
  const channel: Channel = await rabbit.connection.createChannel();
  // EGEN kanal för republishWithAttempt, skild från konsumtionskanalen —
  // se deliveries/consumer.ts för varför.
  const republishChannel: Channel = await rabbit.connection.createChannel();

  // 'events' deklareras EN gång av infra/rabbitmq/init.sh (durable topic).
  // billing-kontot har medvetet inte 'configure' på det, så vi deklarerar
  // det aldrig här — bara binder vår egen kö mot det.
  await channel.assertQueue(QUEUE, { durable: true, arguments: QUEUE_ARGUMENTS });
  for (const key of ROUTING_KEYS) {
    await channel.bindQueue(QUEUE, EXCHANGE, key);
  }
  await channel.prefetch(1);

  const republishWithAttempt = async (msg: ConsumeMessage, attempts: number): Promise<void> => {
    republishChannel.publish("", QUEUE, msg.content, {
      ...msg.properties,
      headers: { ...msg.properties.headers, [ATTEMPTS_HEADER]: attempts },
      persistent: true,
    });
    channel.ack(msg);
  };

  const onMessage = async (msg: ConsumeMessage | null): Promise<void> => {
    if (!msg) return;
    const attempts = Number(msg.properties.headers?.[ATTEMPTS_HEADER] ?? 0);
    try {
      const envelope = JSON.parse(msg.content.toString("utf8"));
      assertValidEnvelope(envelope);
      assertValidPayload(envelope.eventType, envelope.payload);
      // Payloaden är nu validerad mot payment-matched/payment-partial
      // .schema.json — casten är trygg. Formen är identisk för båda
      // eventtyperna (se packages/contracts), så en gemensam cast räcker.
      const payload = envelope.payload as PaymentMatchedPayload | PaymentPartialPayload;

      const outcome = await service.apply({
        eventId: envelope.eventId,
        tenantId: envelope.tenantId,
        correlationId: envelope.correlationId,
        payload,
      });

      logger.info(
        {
          eventId: envelope.eventId,
          eventType: envelope.eventType,
          invoiceId: payload.invoiceId,
          applied: outcome.applied,
          paymentInserted: outcome.paymentInserted,
          invoiceMarkedPaid: outcome.invoiceMarkedPaid,
        },
        "payment-consumer: betalningsevent hanterat",
      );
      channel.ack(msg);
    } catch (error) {
      if (error instanceof EnvelopeValidationError || error instanceof PayloadValidationError) {
        logger.error({ err: error }, "payment-consumer: ogiltigt event, kastas utan requeue");
        channel.ack(msg);
        return;
      }
      const nextAttempts = attempts + 1;
      if (nextAttempts >= MAX_ATTEMPTS) {
        logger.error(
          { err: error, attempts: nextAttempts },
          "payment-consumer: transient fel, gav upp efter maxantal försök (se fas 7 DLQ)",
        );
        channel.ack(msg);
        return;
      }
      logger.warn(
        { err: error, attempts: nextAttempts },
        "payment-consumer: transient fel, försöker igen",
      );
      await sleep(REQUEUE_DELAY_MS);
      await republishWithAttempt(msg, nextAttempts);
    }
  };

  const { consumerTag } = await channel.consume(QUEUE, (msg) => {
    void onMessage(msg);
  });

  return {
    async stop() {
      try {
        await channel.cancel(consumerTag);
        await channel.close();
        await republishChannel.close();
      } catch (error) {
        logger.warn({ err: error }, "payment-consumer: fel vid nedstängning");
      }
    },
  };
}

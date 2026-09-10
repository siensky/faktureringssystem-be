// RabbitMQ-konsument för invoice.delivery_updated (från documents).
//
// Egen kanal, inte den delade `rabbit.channel` — så prefetch(1) här inte
// också strypar system-pingens konsument på samma kanal. Kanalen stängs i
// onClose-haken i index.ts.
//
// Felhantering:
//   - ogiltig envelope/payload  -> ack (permanent skräp, ska inte requeuas
//                                   i all evighet). Loggas som error.
//   - övrigt fel (t.ex. DB nere) -> kort paus + nack med requeue, så
//                                   eventet får ett nytt försök när billing
//                                   är friskt igen. En riktig dead-letter-
//                                   kö med larm läggs till i fas 7.

import {
  EnvelopeValidationError,
  type InvoiceDeliveryUpdatedPayload,
  PayloadValidationError,
  assertValidEnvelope,
  assertValidPayload,
} from "@faktura/contracts";
import type { Logger, RabbitConnection } from "@faktura/shared";
import type { Channel, ConsumeMessage } from "amqplib";
import type { DeliveryService } from "./service";

const EXCHANGE = "events";
const QUEUE = "billing.events";
const ROUTING_KEYS = ["invoice.delivery_updated"];
const REQUEUE_DELAY_MS = 1000;

export interface DeliveryConsumer {
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startDeliveryConsumer(opts: {
  rabbit: RabbitConnection;
  service: DeliveryService;
  logger: Logger;
}): Promise<DeliveryConsumer> {
  const { rabbit, service, logger } = opts;
  const channel: Channel = await rabbit.connection.createChannel();

  // 'events' deklareras EN gång av infra/rabbitmq/init.sh (durable topic).
  // billing-kontot har medvetet inte 'configure' på det (se init.sh), så vi
  // deklarerar det aldrig här — bara binder vår egen kö mot det.
  await channel.assertQueue(QUEUE, { durable: true });
  for (const key of ROUTING_KEYS) {
    await channel.bindQueue(QUEUE, EXCHANGE, key);
  }
  await channel.prefetch(1);

  const onMessage = async (msg: ConsumeMessage | null): Promise<void> => {
    if (!msg) return;
    try {
      const envelope = JSON.parse(msg.content.toString("utf8"));
      assertValidEnvelope(envelope);
      assertValidPayload(envelope.eventType, envelope.payload);
      // Payloaden är nu validerad mot invoice-delivery-updated.schema.json
      // — casten är trygg. assertValidPayload är generisk över alla
      // eventtyper och kan inte smalna typen på egen hand.
      const payload = envelope.payload as InvoiceDeliveryUpdatedPayload;

      const outcome = await service.apply({
        eventId: envelope.eventId,
        tenantId: envelope.tenantId,
        correlationId: envelope.correlationId,
        payload,
      });

      logger.info(
        {
          eventId: envelope.eventId,
          invoiceId: payload.invoiceId,
          deliveryStatus: payload.deliveryStatus,
          applied: outcome.applied,
          statusAdvanced: outcome.statusAdvanced,
          emailInvalidated: outcome.emailInvalidated,
        },
        "delivery-consumer: invoice.delivery_updated hanterat",
      );
      channel.ack(msg);
    } catch (error) {
      if (error instanceof EnvelopeValidationError || error instanceof PayloadValidationError) {
        logger.error({ err: error }, "delivery-consumer: ogiltigt event, kastas utan requeue");
        channel.ack(msg);
        return;
      }
      if (msg.fields.redelivered) {
        // Andra försöket felade också — ge upp så en förgiftad rad inte
        // loopar hett. Fas 7 inför en riktig dead-letter-kö med larm.
        logger.error(
          { err: error },
          "delivery-consumer: transient fel även vid omleverans — ger upp (se fas 7 DLQ)",
        );
        channel.ack(msg);
        return;
      }
      logger.warn({ err: error }, "delivery-consumer: transient fel, requeue efter paus");
      await sleep(REQUEUE_DELAY_MS);
      channel.nack(msg, false, true);
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
      } catch (error) {
        logger.warn({ err: error }, "delivery-consumer: fel vid nedstängning");
      }
    },
  };
}

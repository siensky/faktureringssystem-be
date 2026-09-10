// Transactional outbox: skriv affärsdata OCH eventet i samma transaktion
// (architecture.md #6), låt en separat publisher skicka vidare till
// RabbitMQ. Failar publiceringen efter commit finns datan kvar och eventet
// skickas nästa varv — inget tappas tyst.
//
// Fas 1: minimal publisher (plocka opublicerat, skicka, markera publicerat).
// Enkel bunden backoff vid fel så ett giftigt meddelande inte hot-loopar.
// Exponentiell backoff, dead-letter och larm läggs till i fas 3.

import { randomUUID } from "node:crypto";
import { type EventEnvelope, assertValidEnvelope } from "@faktura/contracts";
import type { JsonObject } from "@faktura/shared";
import type { Logger } from "@faktura/shared";
import type { Sql, TransactionSql } from "postgres";

export const EVENTS_EXCHANGE = "events";

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 20;
const MAX_BACKOFF_STEPS = 10;
const BACKOFF_STEP_MS = 5000;

export interface WriteEventInput {
  sourceService: string;
  eventType: string;
  tenantId: number;
  correlationId?: string;
  payload: JsonObject;
}

/**
 * Skriver ett event till outboxen. Anropas MED transaktionshandtaget från
 * `sql.begin(...)`, aldrig fristående — det är hela poängen. Returnerar
 * eventId (samma id följer med vid en omsänd leverans, vilket är det som
 * gör konsumentens dedup möjlig).
 */
export async function writeEvent(tx: TransactionSql, input: WriteEventInput): Promise<string> {
  const eventId = randomUUID();
  const correlationId = input.correlationId ?? randomUUID();
  await tx`
    INSERT INTO event_outbox (event_id, source_service, event_type, tenant_id, correlation_id, payload)
    VALUES (${eventId}, ${input.sourceService}, ${input.eventType}, ${input.tenantId}, ${correlationId}, ${tx.json(input.payload)})
  `;
  return eventId;
}

interface OutboxRow {
  event_id: string;
  event_type: string;
  tenant_id: number;
  correlation_id: string;
  payload: JsonObject;
  occurred_at: Date;
  attempts: number;
}

export interface OutboxPublisher {
  stop(): void;
}

export function startOutboxPublisher(opts: {
  sql: Sql;
  sourceService: string;
  /**
   * Publicerar och löser upp FÖRST när brokern bekräftat. Måste gå via en
   * confirm-kanal — annars kan en broker som tar emot TCP men tappar
   * meddelandet ge tyst eventförlust, exakt det outboxen ska förhindra.
   */
  publish: (routingKey: string, envelope: EventEnvelope) => Promise<void>;
  logger: Logger;
}): OutboxPublisher {
  const { sql, sourceService, publish, logger } = opts;
  let running = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (!running) return;
    try {
      await sql.begin(async (tx) => {
        const rows = await tx<OutboxRow[]>`
          SELECT event_id, event_type, tenant_id, correlation_id, payload, occurred_at, attempts
          FROM event_outbox
          WHERE source_service = ${sourceService}
            AND published_at IS NULL
            AND failed_at IS NULL
            AND next_attempt_at <= now()
          ORDER BY occurred_at
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `;

        for (const row of rows) {
          const envelope: EventEnvelope = {
            eventId: row.event_id,
            eventType: row.event_type,
            tenantId: row.tenant_id,
            correlationId: row.correlation_id,
            occurredAt: row.occurred_at.toISOString(),
            payload: row.payload,
          };
          try {
            assertValidEnvelope(envelope);
            await publish(row.event_type, envelope); // väntar på brokerns confirm
            await tx`UPDATE event_outbox SET published_at = now() WHERE event_id = ${row.event_id}`;
          } catch (error) {
            const step = Math.min(row.attempts + 1, MAX_BACKOFF_STEPS);
            await tx`
              UPDATE event_outbox
              SET attempts = attempts + 1,
                  last_error = ${String(error)},
                  next_attempt_at = now() + ${`${step * (BACKOFF_STEP_MS / 1000)} seconds`}::interval
              WHERE event_id = ${row.event_id}
            `;
            logger.error(
              { err: error, eventId: row.event_id },
              "outbox: kunde inte publicera event",
            );
          }
        }
      });
    } catch (error) {
      logger.error({ err: error }, "outbox: publisher-varv misslyckades");
    } finally {
      if (running) timer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  timer = setTimeout(tick, POLL_INTERVAL_MS);

  return {
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}

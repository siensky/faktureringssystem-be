// Transactional outbox — delad av alla tjänster som publicerar affärsevent.
// Skriv affärsdata OCH eventet till event_outbox i SAMMA transaktion
// (architecture.md #6). En separat publisher skickar vidare via en
// confirm-kanal och markerar published_at först vid brokerns bekräftelse.
//
// Härdad i fas 3: exponentiell backoff vid fel, och efter MAX_ATTEMPTS
// försök sätts failed_at (dead-letter) och onDeadLetter-haken anropas för
// larm (planens idempotensavsnitt #1).

import { randomUUID } from "node:crypto";
import { type EventEnvelope, assertValidEnvelope } from "@faktura/contracts";
import type { Logger } from "pino";
import type { Sql, TransactionSql } from "postgres";
import type { JsonObject } from "../json";

export const EVENTS_EXCHANGE = "events";

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 12;
const BACKOFF_BASE_SECONDS = 5;
const BACKOFF_CAP_SECONDS = 3600;

export interface WriteEventInput {
  sourceService: string;
  eventType: string;
  tenantId: number;
  correlationId?: string;
  payload: JsonObject;
}

/**
 * Skriver ett event till outboxen. Anropas MED transaktionshandtaget från
 * `sql.begin(...)`, aldrig fristående. Returnerar eventId (samma id följer
 * med vid en omsänd leverans — det är det som gör konsumentens dedup möjlig).
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

function backoffSeconds(attempts: number): number {
  return Math.min(BACKOFF_BASE_SECONDS * 2 ** attempts, BACKOFF_CAP_SECONDS);
}

export function startOutboxPublisher(opts: {
  sql: Sql;
  sourceService: string;
  /** Publicerar och löser upp FÖRST när brokern bekräftat (confirm-kanal). */
  publish: (routingKey: string, envelope: EventEnvelope) => Promise<void>;
  logger: Logger;
  /** Anropas när en rad ger upp efter MAX_ATTEMPTS (dead-letter, larm). */
  onDeadLetter?: (row: { eventId: string; eventType: string }, error: unknown) => void;
}): OutboxPublisher {
  const { sql, sourceService, publish, logger, onDeadLetter } = opts;
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
            const nextAttempts = row.attempts + 1;
            if (nextAttempts >= MAX_ATTEMPTS) {
              await tx`
                UPDATE event_outbox
                SET attempts = ${nextAttempts}, last_error = ${String(error)}, failed_at = now()
                WHERE event_id = ${row.event_id}
              `;
              logger.error(
                { err: error, eventId: row.event_id, eventType: row.event_type },
                "outbox: event dead-letter:at efter maxantal försök",
              );
              onDeadLetter?.({ eventId: row.event_id, eventType: row.event_type }, error);
            } else {
              await tx`
                UPDATE event_outbox
                SET attempts = ${nextAttempts},
                    last_error = ${String(error)},
                    next_attempt_at = now() + ${`${backoffSeconds(row.attempts)} seconds`}::interval
                WHERE event_id = ${row.event_id}
              `;
              logger.warn(
                { err: error, eventId: row.event_id, attempts: nextAttempts },
                "outbox: kunde inte publicera event, backar av",
              );
            }
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

export { backoffSeconds };

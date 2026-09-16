// Fas 7 — GET /internal/ops/alerts. Slår ihop tre kontroller (planens
// härdningsavsnitt: "larm på dead-letter och på omatchade transaktioner
// utan tenant"):
//   1. events.dlq:s djup — RabbitMQ-nivåns dead-letter (konsumenter som
//      gett upp efter maxantal försök, infra/rabbitmq/init.sh)
//   2. event_outbox-rader med failed_at satt — publiceringsnivåns
//      dead-letter (planens Idempotens #1), per source_service
//   3. payments obetalbara transaktioner utan tenant — S2S mot payments
//      EGEN drift-endpoint, ALDRIG en direkt DB-läsning över
//      tjänstegränsen (architecture.md #2)
//
// Själva kontrollerna (rena, testbara) bor i checks.ts — den här filen är
// bara ledningsdragningen till riktig I/O (RabbitMQ, Postgres, S2S-HTTP).
//
// Promise.allSettled är ett ANDRA skyddslager, inte det första
// (kodgranskning PR #7, fynd 2): checks.ts:s tre funktioner fångar redan
// sina egna fel och kan aldrig avvisa sitt löfte — det är DEN garantin som
// gör att en trasig kontroll syns som ETT fel i svaret. allSettled är ett
// strukturellt säkerhetsnät ifall en framtida ändring tar bort ett inre
// try/catch i tron att resten av kedjan ändå skyddar.

import { checkQueueDepth, getServiceToken } from "@faktura/shared";
import type { ChannelModel } from "amqplib";
import type Redis from "ioredis";
import type { Sql } from "postgres";
import { config } from "../config";
import {
  checkDeadLetterQueue,
  checkOutboxDeadLetters,
  checkUnmatchedTransactions,
  errorMessage,
} from "./checks";
import { countOutboxDeadLettersBySource } from "./repository";
import type { AlertsSummary } from "./types";

const DEAD_LETTER_QUEUE = "events.dlq";

function fromSettled<T>(result: PromiseSettledResult<T>, onRejected: (message: string) => T): T {
  return result.status === "fulfilled" ? result.value : onRejected(errorMessage(result.reason));
}

export function createAlertsService(deps: {
  sql: Sql;
  rabbitConnection: ChannelModel;
  redis: Redis;
}) {
  const { sql, rabbitConnection, redis } = deps;

  async function fetchUnmatchedCount(): Promise<number> {
    const token = await getServiceToken({
      authBaseUrl: config.authBaseUrl,
      clientId: config.billingClientId,
      clientSecret: config.billingClientSecret,
      redis,
      scopes: config.billingClientScopes,
    });
    const res = await fetch(`${config.paymentsBaseUrl}/internal/ops/payments/unknown-bankgiro`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`payments svarade ${res.status}`);
    const body = (await res.json()) as { count: number };
    return body.count;
  }

  return {
    async getAlerts(): Promise<AlertsSummary> {
      const [dlq, outbox, unmatched] = await Promise.allSettled([
        checkDeadLetterQueue(() => checkQueueDepth(rabbitConnection, DEAD_LETTER_QUEUE)),
        checkOutboxDeadLetters(() => countOutboxDeadLettersBySource(sql)),
        checkUnmatchedTransactions(fetchUnmatchedCount),
      ]);
      return {
        deadLetterQueue: fromSettled(dlq, (error) => ({ depth: 0, error })),
        outboxDeadLetters: fromSettled(outbox, (error) => ({
          count: 0,
          bySourceService: {},
          error,
        })),
        unmatchedTransactions: fromSettled(unmatched, (error) => ({ count: 0, error })),
      };
    },
  };
}

export type AlertsService = ReturnType<typeof createAlertsService>;

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
// Var för sig, inte Promise.all: en enskild trasig kontroll (t.ex.
// payments nere) ska synas som ETT fel i svaret, inte dölja de andra två
// eller få hela endpointen att 500:a.

import { checkQueueDepth, getServiceToken } from "@faktura/shared";
import type { ChannelModel } from "amqplib";
import type Redis from "ioredis";
import type { Sql } from "postgres";
import { config } from "../config";
import { countOutboxDeadLettersBySource } from "./repository";
import type { AlertsSummary } from "./types";

const DEAD_LETTER_QUEUE = "events.dlq";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAlertsService(deps: {
  sql: Sql;
  rabbitConnection: ChannelModel;
  redis: Redis;
}) {
  const { sql, rabbitConnection, redis } = deps;

  async function deadLetterQueue(): Promise<AlertsSummary["deadLetterQueue"]> {
    try {
      return { depth: await checkQueueDepth(rabbitConnection, DEAD_LETTER_QUEUE) };
    } catch (error) {
      return { depth: 0, error: errorMessage(error) };
    }
  }

  async function outboxDeadLetters(): Promise<AlertsSummary["outboxDeadLetters"]> {
    try {
      const rows = await countOutboxDeadLettersBySource(sql);
      const bySourceService: Record<string, number> = {};
      let count = 0;
      for (const row of rows) {
        bySourceService[row.source_service] = row.n;
        count += row.n;
      }
      return { count, bySourceService };
    } catch (error) {
      return { count: 0, bySourceService: {}, error: errorMessage(error) };
    }
  }

  async function unmatchedTransactions(): Promise<AlertsSummary["unmatchedTransactions"]> {
    try {
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
      return { count: body.count };
    } catch (error) {
      return { count: 0, error: errorMessage(error) };
    }
  }

  return {
    async getAlerts(): Promise<AlertsSummary> {
      const [dlq, outbox, unmatched] = await Promise.all([
        deadLetterQueue(),
        outboxDeadLetters(),
        unmatchedTransactions(),
      ]);
      return { deadLetterQueue: dlq, outboxDeadLetters: outbox, unmatchedTransactions: unmatched };
    },
  };
}

export type AlertsService = ReturnType<typeof createAlertsService>;

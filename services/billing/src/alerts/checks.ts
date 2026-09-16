// De tre RENA kontrollerna bakom GET /internal/ops/alerts, i en egen fil
// utan beroende på config.ts eller någon riktig I/O (Sql/ChannelModel/
// Redis/fetch) — bara så att de går att importera i ett enhetstest utan
// att config.ts:s loadEnv() kraschar på saknade miljövariabler (den kraschen
// slog till första gången, kodgranskning PR #7 fynd 3: att lägga dessa i
// samma fil som createAlertsService, som MÅSTE importera config för det
// riktiga HTTP-anropet, gjorde hela filen — och därmed även de rena
// funktionerna i den — okörbar utan en full miljö).
//
// Var för sig, inte bara Promise.all i anroparen (kodgranskning PR #7,
// fynd 2): varje funktion FÅNGAR sitt eget fel och kan aldrig avvisa sitt
// löfte. Det är DEN garantin — inte hur anroparen kombinerar löftena — som
// gör att en trasig kontroll syns som ETT fel i svaret utan att dölja de
// andra två. service.ts lägger Promise.allSettled ovanpå som ett rent
// strukturellt andra skyddslager, se dess egen kommentar.

import type { OutboxDeadLetterCount } from "./repository";
import type { AlertsSummary } from "./types";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function checkDeadLetterQueue(
  fetchDepth: () => Promise<number>,
): Promise<AlertsSummary["deadLetterQueue"]> {
  try {
    return { depth: await fetchDepth() };
  } catch (error) {
    return { depth: 0, error: errorMessage(error) };
  }
}

export async function checkOutboxDeadLetters(
  fetchRows: () => Promise<OutboxDeadLetterCount[]>,
): Promise<AlertsSummary["outboxDeadLetters"]> {
  try {
    const rows = await fetchRows();
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

export async function checkUnmatchedTransactions(
  fetchCount: () => Promise<number>,
): Promise<AlertsSummary["unmatchedTransactions"]> {
  try {
    return { count: await fetchCount() };
  } catch (error) {
    return { count: 0, error: errorMessage(error) };
  }
}

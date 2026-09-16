// Fas 7 — larm på dead-letter (planens härdningsavsnitt). Läser den
// GEMENSAMMA event_outbox-tabellen (architecture.md, Gemensamma tabeller)
// tvärs alla source_service — inte tenant-filtrerat, inte en metod på
// TenantScopedRepository, av samma skäl som automation/repository.ts:s
// cleanupPublishedOutbox: det här är en driftsvy över infrastruktur, inte
// affärsdata.

import type { Sql } from "postgres";

export interface OutboxDeadLetterCount {
  source_service: string;
  n: number;
}

/** Event som gett upp efter maxantal publiceringsförsök (failed_at satt), per tjänst. */
export async function countOutboxDeadLettersBySource(sql: Sql): Promise<OutboxDeadLetterCount[]> {
  return sql<OutboxDeadLetterCount[]>`
    SELECT source_service, count(*)::int AS n
    FROM event_outbox
    WHERE failed_at IS NOT NULL
    GROUP BY source_service
    ORDER BY source_service
  `;
}

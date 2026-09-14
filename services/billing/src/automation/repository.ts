// Städning av GEMENSAMMA tabeller (architecture.md, Gemensamma tabeller):
// idempotency_keys och event_outbox delas av alla tjänster, så de här
// funktionerna är MEDVETET inte tenant-filtrerade eller metoder på en
// TenantScopedRepository — en global städning är precis vad de ska göra.
// Ingen SQL utanför repository-lagret (database.md #22) trots att modulen
// inte har någon egen "ägd" tabell.

import type { Sql } from "postgres";

const OUTBOX_RETENTION_DAYS = 30;

/** Idempotens-nycklar (planens idempotensavsnitt #3) vars TTL gått ut. */
export async function cleanupExpiredIdempotencyKeys(sql: Sql): Promise<number> {
  const rows = await sql`DELETE FROM idempotency_keys WHERE expires_at < now()`;
  return rows.count;
}

/**
 * Publicerade outbox-rader äldre än 30 dagar (planens idempotensavsnitt
 * #1). Rör ALDRIG failed_at-rader (dead-letter) — de ska finnas kvar för
 * manuell uppföljning, inte städas bort tyst.
 */
export async function cleanupPublishedOutbox(sql: Sql): Promise<number> {
  const rows = await sql`
    DELETE FROM event_outbox
    WHERE published_at IS NOT NULL AND published_at < now() - ${`${OUTBOX_RETENTION_DAYS} days`}::interval
  `;
  return rows.count;
}

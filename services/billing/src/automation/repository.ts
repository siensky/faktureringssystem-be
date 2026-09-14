// Städning av GEMENSAMMA tabeller (architecture.md, Gemensamma tabeller).
// Ingen SQL utanför repository-lagret (database.md #22) trots att modulen
// inte har någon egen "ägd" tabell.
//
// idempotency_keys och event_outbox behandlas OLIKA här, med skäl:
//
//   idempotency_keys har INGEN ägande-kolumn alls (varken tenant-scopad
//   utöver tenant_id, eller service-scopad) — TTL:en (expires_at) är den
//   enda sanningen, och en utgången nyckel är död för ALLA tjänster lika.
//   En global DELETE är alltså inte ett gränsintrång, det är den enda
//   möjliga formen.
//
//   event_outbox har DÄREMOT source_service, uttryckligen till för att
//   "skilja raderna åt" mellan tjänster (architecture.md, Gemensamma
//   tabeller: "varje tjänst rör bara sina egna"). En första version av den
//   här funktionen saknade det filtret och skulle ha låtit billings
//   nattliga jobb radera auths, payments och documents publicerade
//   event-historik — ett tjänstegränsintrång upptäckt i kodgranskning av
//   PR #6. Varje tjänst städar därför bara sina EGNA rader; att auth,
//   payments och documents saknar en motsvarande egen städning just nu är
//   en känd lucka (samma sorts avgränsning som services/auth/src/
//   token-cleanup.ts redan gör för user_tokens), inte något den här
//   funktionen ska kompensera för genom att gissa åt dem.

import type { Sql } from "postgres";

const OUTBOX_RETENTION_DAYS = 30;

/** Idempotens-nycklar (planens idempotensavsnitt #3) vars TTL gått ut. */
export async function cleanupExpiredIdempotencyKeys(sql: Sql): Promise<number> {
  const rows = await sql`DELETE FROM idempotency_keys WHERE expires_at < now()`;
  return rows.count;
}

/**
 * Publicerade outbox-rader äldre än 30 dagar (planens idempotensavsnitt
 * #1), MEN bara `sourceService`s egna — se filhuvudet. Rör ALDRIG
 * failed_at-rader (dead-letter) — de ska finnas kvar för manuell
 * uppföljning, inte städas bort tyst.
 */
export async function cleanupPublishedOutbox(sql: Sql, sourceService: string): Promise<number> {
  const rows = await sql`
    DELETE FROM event_outbox
    WHERE source_service = ${sourceService}
      AND published_at IS NOT NULL
      AND published_at < now() - ${`${OUTBOX_RETENTION_DAYS} days`}::interval
  `;
  return rows.count;
}

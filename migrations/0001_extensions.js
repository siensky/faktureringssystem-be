/**
 * Fas 0: bara de Postgres-extensions all senare databaskod förutsätter.
 * Ingen affärstabell här — de kommer med "en migration per fas"
 * (database.md #1): 0002_auth.js i fas 1, 0003_shared.js i samma fas,
 * 0004_billing.js i fas 3, och så vidare enligt PLAN.md.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // gen_random_uuid() används för eventId/correlationId i event_outbox
  // (fas 1) och för idempotency_keys — pgcrypto ger den funktionen utan
  // att appkoden behöver generera UUID:er och skicka in dem.
  pgm.sql("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql("DROP EXTENSION IF EXISTS pgcrypto;");
};

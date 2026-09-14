/**
 * Fas 6 — kodgranskning av PR #6, fynd 3: invoice_templates.billing_day.
 *
 * advanceByInterval (services/billing/src/domain/dates.ts) rullar fram
 * next_generation_date en period i taget och KLAMPAR dagen mot målmånadens
 * längd (31 jan -> 28 feb i ett icke-skottår). Utan ett separat, aldrig
 * klampat ankardygn drev en mall som startade på dag 29/30/31 permanent
 * iväg: nästa körning tar dagen ur det REDAN klampade next_generation_date
 * (28), så mars blir 28 i stället för att återhämta 31 — kunden tappar sin
 * ursprungliga faktureringsdag för alltid efter första korta månaden.
 *
 * billing_day lagrar det ursprungliga, aldrig klampade dygnet (1-31) och
 * är det advanceByInterval nu klampar MOT varje gång — next_generation_date
 * själv får fortsätta vara den faktiska (ibland klampade) fakturadagen för
 * INNEVARANDE period.
 *
 * En applicerad migration ändras aldrig (database.md #2) — 0004_billing.js
 * rörs inte, det här är en ny migration som lägger till kolumnen på den
 * redan existerande tabellen. NOT NULL med en backfyllning i samma
 * transaktion: det finns bara testdata i tabellen ännu (ingen mall-CRUD
 * finns, se PR-beskrivningen), men en NOT NULL-kolumn utan default hade
 * krävt två steg i en riktigt deployad databas — här räcker ett, eftersom
 * ingen produktionsrad någonsin kört.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE invoice_templates ADD COLUMN billing_day SMALLINT;
    UPDATE invoice_templates SET billing_day = EXTRACT(DAY FROM next_generation_date)::smallint;
    ALTER TABLE invoice_templates ALTER COLUMN billing_day SET NOT NULL;
    ALTER TABLE invoice_templates ADD CONSTRAINT invoice_templates_billing_day_range
      CHECK (billing_day BETWEEN 1 AND 31);
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE invoice_templates DROP COLUMN billing_day;
  `);
};

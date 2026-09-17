/**
 * Fas 10 — portalbetalning via Stripe (testläge): stripe_payments.
 *
 * EGEN tabell, inte en utökning av bank_transactions (0006_payments.js).
 * bank_transactions.bankgiro/ocr är NOT NULL och dess status-CHECK är
 * byggd kring bank-specifika utfall (unknown_bankgiro, ambiguous,
 * overpayment) som inte kan inträffa via Stripe Checkout — kunden kan
 * inte betala ett annat belopp än det Stripe-sessionen skapades med, och
 * tenant+faktura är redan kända vid skapandet (ingen bankgiro-/OCR-
 * uppslagning). Att pressa in Stripe i bank_transactions hade gett
 * meningslösa NULL-bankgiro/OCR-fält och statusgrenar som aldrig kan
 * nås. Samma resonemang som email_webhook_events (0005_documents.js) är
 * en egen tabell i stället för att delas med något annat.
 *
 * paid_at (NULLABLE TIMESTAMPTZ), inte en status-kolumn: NULL betyder
 * "väntar", satt betyder "betald" (database.md #14 — NULL betyder något
 * specifikt). Samma idiom som invoices.sent_at/event_outbox.published_at.
 * Webhooken gör en VILLKORAD övergång `WHERE paid_at IS NULL` — en
 * omlevererad Stripe-event hittar raden redan betald och gör inget
 * (samma mönster som email_outbox 'queued' -> 'sent').
 *
 * tenant_id/invoice_id är NOT NULL (till skillnad från bank_transactions
 * tenant_id, som kan vara NULL i väntan på bankgiro-uppslag) — en Stripe-
 * session skapas alltid FÖR en specifik, redan validerad faktura
 * (services/billing/src/portal/services.ts), så det finns aldrig ett
 * "okänt mottagare"-tillstånd att representera.
 *
 * Cross-tjänst-FK:ar mot auths tenants och billings invoices — samma
 * mönster som bank_transactions.tenant_id/matched_invoice_id redan
 * använder (rules/architecture.md #2). RESTRICT mot invoices: en
 * Stripe-betalning kopplad till en faktura får inte se fakturan
 * försvinna under sig.
 *
 * GRANT: 0008_service_roles.js är redan skeppad (database.md #2, en
 * applicerad migration ändras aldrig) — en ny egen tabell behöver sin
 * GRANT här, i samma migration som skapar den.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE stripe_payments (
      id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id          INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      invoice_id         INTEGER NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
      stripe_session_id  TEXT NOT NULL UNIQUE,
      -- Satt av webhooken när betalningen bokförs — spårbarhet till VILKET
      -- Stripe-event som orsakade övergången. Ingen egen unik-constraint:
      -- paid_at IS NULL-villkoret i UPDATE:en är det som gör webhooken
      -- idempotent, inte den här kolumnen (se moduldocen ovan).
      stripe_event_id    TEXT,
      amount_ore         BIGINT NOT NULL CHECK (amount_ore > 0),
      currency           TEXT NOT NULL,
      paid_at            TIMESTAMPTZ,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX stripe_payments_tenant_id_idx ON stripe_payments (tenant_id);
    CREATE INDEX stripe_payments_invoice_id_idx ON stripe_payments (invoice_id);

    GRANT SELECT, INSERT, UPDATE, DELETE ON stripe_payments TO payments;
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS stripe_payments;
  `);
};

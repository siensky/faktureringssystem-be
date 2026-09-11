/**
 * Fas 5 — payments: bankgiro-/OCR-matchning av inkommande betalningar.
 *
 * En tabell, ägd av payments (architecture.md, Tjänstegränser):
 *
 *   bank_transactions — en rad per inkommande banktransaktion, oavsett
 *                       källa (mockbank-webhook eller BgMax-liknande
 *                       filimport). GLOBAL dedup-nyckel UNIQUE (source,
 *                       external_id) — samma motivering som
 *                       email_webhook_events (0005_documents.js): tenant
 *                       kan inte vara del av nyckeln eftersom den härleds
 *                       ur bankgirot och en omimport ska ge exakt samma
 *                       nyckel oavsett vad uppslaget råkar ge den gången.
 *
 * payments skriver ALDRIG till invoices/invoice_payments (architecture.md
 * #20) — en lyckad matchning publicerar payment.matched/payment.partial
 * och en ny konsument i billing gör den faktiska bokföringen. Se
 * fas 5-planen, avsnitt "Arkitekturprincipen som styr allt i den här
 * fasen".
 *
 * company_settings ägs av billing och 0004_billing.js är redan shippad på
 * main (database.md #2 — en shippad migration ändras aldrig). Det unika
 * indexet på company_settings.bankgiro läggs därför här i stället, trots
 * att tabellen inte ägs av payments: det skyddar PAYMENTS korrekthet
 * (bankgiro -> tenant måste vara en funktion), inte billings.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE bank_transactions (
      id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      -- NULL = inget bankgiro kunde härledas till en tenant (database.md
      -- #14: NULL betyder något specifikt här, inte "vet inte"). Sådana
      -- rader syns bara i driftvyn (GET /internal/ops/payments/unknown-bankgiro),
      -- aldrig i någon tenants backoffice.
      tenant_id          INTEGER REFERENCES tenants (id) ON DELETE CASCADE,
      source             TEXT NOT NULL CHECK (source IN ('bgmax', 'webhook:mockbank')),
      external_id        TEXT NOT NULL,
      bankgiro           TEXT NOT NULL,
      ocr                TEXT NOT NULL,
      payer_name         TEXT,
      amount_ore         BIGINT NOT NULL CHECK (amount_ore > 0),
      booked_at          TIMESTAMPTZ NOT NULL,
      received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      status             TEXT NOT NULL
        CHECK (status IN ('matched', 'unmatched', 'manual_review', 'ignored')),
      unmatched_reason   TEXT
        CHECK (unmatched_reason IN ('unknown_bankgiro', 'unknown_ocr', 'overpayment', 'ambiguous')),
      -- RESTRICT: en bokförd transaktion hör ihop med en faktura som inte
      -- får försvinna under fötterna på den.
      matched_invoice_id INTEGER REFERENCES invoices (id) ON DELETE RESTRICT,
      ignored_reason     TEXT,

      -- GLOBAL, inte per tenant — se filhuvudet ovan och
      -- email_webhook_events (0005_documents.js) för samma resonemang.
      CONSTRAINT bank_transactions_dedup UNIQUE (source, external_id),

      -- Kopplar status till vilka övriga fält som MÅSTE/FÅR vara satta
      -- (database.md #19, samma mönster som customers_type_shape i 0004).
      CONSTRAINT bank_transactions_status_shape CHECK (
        (status = 'matched'
          AND tenant_id IS NOT NULL AND matched_invoice_id IS NOT NULL
          AND unmatched_reason IS NULL)
        OR (status = 'unmatched'
          AND tenant_id IS NULL AND unmatched_reason = 'unknown_bankgiro'
          AND matched_invoice_id IS NULL)
        OR (status = 'manual_review'
          AND tenant_id IS NOT NULL
          AND unmatched_reason IN ('unknown_ocr', 'overpayment', 'ambiguous')
          AND matched_invoice_id IS NULL)
        OR (status = 'ignored' AND matched_invoice_id IS NULL)
      )
    );

    CREATE INDEX bank_transactions_tenant_id_idx ON bank_transactions (tenant_id);
    -- Manuell kö, tenant-scopad: GET /admin/payments/unmatched.
    CREATE INDEX bank_transactions_manual_review_idx ON bank_transactions (tenant_id, received_at)
      WHERE status = 'manual_review';
    -- Driftvyn: bara okänt-bankgiro-raderna, utanför tenant-modellen.
    CREATE INDEX bank_transactions_unknown_bankgiro_idx ON bank_transactions (received_at)
      WHERE tenant_id IS NULL;

    -- Se filhuvudets kommentar om varför den här ligger här trots att
    -- company_settings ägs av billing. Partiellt unikt index (CONSTRAINT
    -- UNIQUE stöder inte WHERE i Postgres).
    CREATE UNIQUE INDEX company_settings_bankgiro_key ON company_settings (bankgiro)
      WHERE bankgiro IS NOT NULL;
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS company_settings_bankgiro_key;
    DROP TABLE IF EXISTS bank_transactions;
  `);
};

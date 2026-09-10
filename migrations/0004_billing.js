/**
 * Fas 3 — billing: company_settings, customers, invoices, invoice_items,
 * invoice_snapshots, invoice_payments, invoice_templates.
 *
 * Pengar är BIGINT i öre, kolumnnamn slutar på _ore (database.md #6–7).
 * quantity/vat_rate är NUMERIC — de är inte pengar (#9).
 * Slutna värdemängder: TEXT + CHECK, inte ENUM (#16, nyanserad).
 * ON DELETE: CASCADE för rader som saknar mening utan sin förälder
 * (invoice_items), RESTRICT för sådant som aldrig får försvinna under
 * fötterna på en bokföringspost (kund med fakturor) (#20).
 *
 * Fakturanummer och OCR tilldelas vid UTSKICK (POST /:id/send), inte när
 * utkastet skapas — ett utkast är ingen bokföringspost, och att förbruka
 * ett nummer på ett utkast som sedan raderas skulle riva ett hål i serien
 * (domain.md #6). Därför är invoice_number/ocr_number NULL för utkast, med
 * en CHECK som kräver dem för allt annat.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    -- En rad per tenant. Skapas lat (billing/src/company-settings) första
    -- gången en admin fyller i den eller en faktura skickas. En GET som
    -- inte hittar raden svarar med defaultvärden i stället för att skapa
    -- den — läsningar har inga sidoeffekter.
    CREATE TABLE company_settings (
      tenant_id          INTEGER PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
      company_name       TEXT,
      org_number         TEXT,
      bankgiro           TEXT,
      vat_number         TEXT,
      address_street     TEXT,
      address_zip        TEXT,
      address_city       TEXT,
      logo_url           TEXT,
      next_invoice_number INTEGER NOT NULL DEFAULT 1,
      reminder_fee_ore   BIGINT NOT NULL DEFAULT 6000,
      payment_terms_days INTEGER NOT NULL DEFAULT 30,
      tenant_status      TEXT NOT NULL DEFAULT 'active' CHECK (tenant_status IN ('active', 'suspended')),
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE customers (
      id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id          INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      customer_type      TEXT NOT NULL CHECK (customer_type IN ('company', 'private')),
      name               TEXT NOT NULL,
      email              TEXT NOT NULL,
      email_valid        BOOLEAN NOT NULL DEFAULT true,
      -- Företagskund: org_number. Privatkund: personnumret KRYPTERAT
      -- (pnr_encrypted, AES-GCM) + pnr_hmac för exakt uppslag, kanoniserat
      -- till 12 siffror innan HMAC (@faktura/shared normalizePnr) så det
      -- matchar users.pnr_hash. Aldrig i klartext (domain.md #20).
      org_number         TEXT,
      pnr_encrypted      TEXT,
      pnr_hmac           TEXT,
      address_street     TEXT,
      address_zip        TEXT,
      address_city       TEXT,
      -- NULL = ärv company_settings.payment_terms_days
      payment_terms_days INTEGER,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- Exakt en form: företag har org_number och inget pnr, privat har
      -- bådadera pnr-fälten och inget org_number. Databasen ska inte kunna
      -- hamna mittemellan.
      CONSTRAINT customers_type_shape CHECK (
        (customer_type = 'company'
          AND org_number IS NOT NULL
          AND pnr_encrypted IS NULL AND pnr_hmac IS NULL)
        OR
        (customer_type = 'private'
          AND pnr_encrypted IS NOT NULL AND pnr_hmac IS NOT NULL
          AND org_number IS NULL)
      )
    );
    CREATE INDEX customers_tenant_id_idx ON customers (tenant_id);
    -- Per tenant unikt på personnummer så samma person inte blir två
    -- kundrader. NULL (företagskunder) räknas inte av unique.
    CREATE UNIQUE INDEX customers_pnr_hmac_key ON customers (tenant_id, pnr_hmac)
      WHERE pnr_hmac IS NOT NULL;

    CREATE TABLE invoice_templates (
      id                   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id            INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      customer_id          INTEGER NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
      interval             TEXT NOT NULL CHECK (interval IN ('monthly', 'quarterly', 'yearly')),
      next_generation_date DATE NOT NULL,
      is_active            BOOLEAN NOT NULL DEFAULT true,
      template_data        JSONB NOT NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX invoice_templates_tenant_id_idx ON invoice_templates (tenant_id);
    CREATE INDEX invoice_templates_due_idx ON invoice_templates (next_generation_date) WHERE is_active;

    CREATE TABLE invoices (
      id                       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id                INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      customer_id              INTEGER NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
      -- NULL på utkast; tilldelas vid send/credit under radlås på
      -- company_settings.next_invoice_number.
      invoice_number           INTEGER,
      ocr_number               TEXT,
      invoice_type             TEXT NOT NULL DEFAULT 'invoice'
        CHECK (invoice_type IN ('invoice', 'credit_note', 'reminder')),
      -- Bokföringsmässig livscykel, ägs av admins handling i billing.
      status                   TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'credited', 'superseded', 'settled')),
      -- Leveransstatus, ägs av documents rapporter. Monoton.
      delivery_status          TEXT NOT NULL DEFAULT 'none'
        CHECK (delivery_status IN ('none', 'queued', 'sent', 'delivered', 'bounced', 'failed')),
      date_issued              DATE NOT NULL,
      date_due                 DATE NOT NULL,
      currency                 TEXT NOT NULL DEFAULT 'SEK',
      total_excl_vat_ore       BIGINT NOT NULL DEFAULT 0,
      total_vat_ore            BIGINT NOT NULL DEFAULT 0,
      total_incl_vat_ore       BIGINT NOT NULL DEFAULT 0,
      credits_invoice_id       INTEGER REFERENCES invoices (id),
      reminds_invoice_id       INTEGER REFERENCES invoices (id),
      superseded_by_invoice_id INTEGER REFERENCES invoices (id),
      parent_template_id       INTEGER REFERENCES invoice_templates (id) ON DELETE SET NULL,
      sent_at                  TIMESTAMPTZ,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- Per tenant, inte globalt (database.md #18). Kollision är omöjlig
      -- per konstruktion eftersom OCR härleds ur invoice_number, men
      -- constrainten ligger kvar som databasgaranti. Flera NULL tillåts
      -- (utkast), så partiell unik hanteras av Postgres NULL-semantik.
      CONSTRAINT invoices_number_unique UNIQUE (tenant_id, invoice_number),
      CONSTRAINT invoices_ocr_unique UNIQUE (tenant_id, ocr_number),
      -- Bara utkast får sakna nummer/OCR.
      CONSTRAINT invoices_numbered_unless_draft CHECK (
        status = 'draft'
        OR (invoice_number IS NOT NULL AND ocr_number IS NOT NULL)
      )
    );
    CREATE INDEX invoices_tenant_id_idx ON invoices (tenant_id);
    CREATE INDEX invoices_customer_id_idx ON invoices (customer_id);
    CREATE INDEX invoices_outstanding_idx ON invoices (tenant_id, status)
      WHERE status IN ('sent', 'overdue');

    CREATE TABLE invoice_items (
      id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      invoice_id         INTEGER NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
      tenant_id          INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      position           INTEGER NOT NULL,
      description        TEXT NOT NULL,
      quantity           NUMERIC(12, 3) NOT NULL DEFAULT 1,
      unit               TEXT NOT NULL DEFAULT 'st',
      unit_price_ore     BIGINT NOT NULL,
      vat_rate           NUMERIC(5, 2) NOT NULL CHECK (vat_rate IN (0, 6, 12, 25)),
      line_excl_vat_ore  BIGINT NOT NULL,
      line_vat_ore       BIGINT NOT NULL,
      line_incl_vat_ore  BIGINT NOT NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX invoice_items_invoice_id_idx ON invoice_items (invoice_id);
    CREATE INDEX invoice_items_tenant_id_idx ON invoice_items (tenant_id);

    -- Frusen kopia av fakturan som den såg ut vid utskick. Documents
    -- renderar PDF ur den här, aldrig de levande tabellerna, så en senare
    -- ändring i company_settings inte ändrar en bokförd faktura.
    CREATE TABLE invoice_snapshots (
      invoice_id INTEGER PRIMARY KEY REFERENCES invoices (id) ON DELETE CASCADE,
      tenant_id  INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      payload    JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX invoice_snapshots_tenant_id_idx ON invoice_snapshots (tenant_id);

    -- En rad per inbetalning (Domänmodell #4). paid_ore beräknas som
    -- SUM(amount_ore), lagras aldrig. UNIQUE (tenant_id, payment_id) gör en
    -- dubbellevererad betalning till en unique-violation i stället för ett
    -- tyst felaktigt saldo. Fylls i av fas 5.
    CREATE TABLE invoice_payments (
      id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id  INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      invoice_id INTEGER NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
      payment_id TEXT NOT NULL,
      amount_ore BIGINT NOT NULL,
      booked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT invoice_payments_dedup UNIQUE (tenant_id, payment_id)
    );
    CREATE INDEX invoice_payments_invoice_id_idx ON invoice_payments (invoice_id);
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS invoice_payments;
    DROP TABLE IF EXISTS invoice_snapshots;
    DROP TABLE IF EXISTS invoice_items;
    DROP TABLE IF EXISTS invoices;
    DROP TABLE IF EXISTS invoice_templates;
    DROP TABLE IF EXISTS customers;
    DROP TABLE IF EXISTS company_settings;
  `);
};

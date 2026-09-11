/**
 * Fas 4 — documents: PDF-rendering, S3-lagring och e-postutskick.
 *
 * Tre tabeller, alla ägda av documents-tjänsten (architecture.md,
 * Tjänstegränser):
 *
 *   documents            — en rad per genererad PDF. Den NATURLIGA
 *                          idempotensnyckeln UNIQUE (tenant_id, invoice_id,
 *                          document_type) är garantin mot dubbelarbete när
 *                          ett invoice.sent levereras två gånger (planens
 *                          idempotensavsnitt #5, architecture.md #7 fall B).
 *                          S3-nyckeln härleds ur samma tre värden, så
 *                          uppladdningen blir självskrivande.
 *
 *   email_outbox         — ett utskick per faktura. UNIQUE (tenant_id,
 *                          invoice_id, email_type) (planens idempotensavsnitt
 *                          #6). Statusövergångarna görs som VILLKORADE
 *                          UPDATE (... WHERE status = <förväntat>), aldrig
 *                          en blind skrivning — annars kan två arbetare
 *                          båda läsa 'queued' och kunden får fakturan två
 *                          gånger. `status` speglar delivery_status i
 *                          billing (domain.md #29) minus 'none'.
 *
 *   email_webhook_events — dedup av leverantörens event-id för
 *                          POST /webhooks/email-status (planens Säkerhet:
 *                          Webhooks, punkt 2). GLOBAL nyckel, inte per
 *                          tenant: webhooken har ingen betrodd tenant
 *                          (samma skäl som planens idempotensavsnitt #4 ger
 *                          för filimport).
 *
 * invoices.status rörs ALDRIG härifrån — den är billings bokföringsstatus
 * och ändras bara av POST /admin/invoices/:id/send (domain.md #28). Det
 * documents rapporterar tillbaka är invoices.delivery_status, och det sker
 * via event till billing (architecture.md #20), aldrig med en skrivning
 * över tjänstegränsen.
 *
 * event_outbox / processed_events finns redan (0003_shared) och delas —
 * documents skriver outbox-rader med source_service = 'documents' och
 * dedupar mot processed_events med consumer = 'documents'.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    -- En rad per genererad PDF. Renderas ur invoice_snapshots (via
    -- GET /internal/invoices/:id/snapshot), aldrig ur de levande
    -- billing-tabellerna, så en senare ändring i company_settings inte
    -- ändrar en redan bokförd fakturas PDF (database.md #30).
    CREATE TABLE documents (
      id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id     INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      -- ON DELETE RESTRICT: en genererad PDF hör ihop med en bokföringspost
      -- och får inte försvinna under fötterna på den. Utkast (som får
      -- raderas) har aldrig en PDF, så detta blockerar inget legitimt.
      invoice_id    INTEGER NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
      document_type TEXT NOT NULL CHECK (document_type IN ('invoice', 'credit_note')),
      -- S3-nyckel: tenantId/invoices/{invoiceId}/{documentType}.pdf. Härledd
      -- ur de tre värdena nedan, så samma event två gånger skriver samma
      -- objekt till samma nyckel (planens idempotensavsnitt #5).
      storage_key   TEXT NOT NULL,
      byte_size     BIGINT NOT NULL,
      -- SHA-256 över PDF-bytena. Billig integritetskontroll och gör det
      -- möjligt att se om en omrendering faktiskt gav samma dokument.
      sha256        TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- DEN naturliga idempotensnyckeln (architecture.md #7 fall B): ett
      -- dubbellevererat invoice.sent blir en unique-violation här i stället
      -- för en andra PDF. processed_events är bara en optimering ovanpå.
      CONSTRAINT documents_natural_key UNIQUE (tenant_id, invoice_id, document_type)
    );
    CREATE INDEX documents_tenant_id_idx ON documents (tenant_id);
    CREATE INDEX documents_invoice_id_idx ON documents (invoice_id);

    -- Ett utskick per faktura. Skapas 'queued' när PDF:en lagts i storage,
    -- plockas av en arbetare som skickar mejlet och sätter 'sent', och
    -- flyttas vidare till 'delivered'/'bounced'/'failed' av
    -- POST /webhooks/email-status. Varje övergång är en VILLKORAD UPDATE.
    CREATE TABLE email_outbox (
      id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id           INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      invoice_id          INTEGER NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
      email_type          TEXT NOT NULL CHECK (email_type IN ('invoice', 'credit_note')),
      -- PDF:en som bifogas. RESTRICT: mejlraden pekar på ett dokument som
      -- ska finnas kvar så länge utskicket kan följas upp.
      document_id         INTEGER NOT NULL REFERENCES documents (id) ON DELETE RESTRICT,
      recipient_email     TEXT NOT NULL,
      subject             TEXT NOT NULL,
      -- Förs vidare hela kedjan (architecture.md #5): satt av konsumenten
      -- när mejlet köas, återanvänt i delivery_updated-eventen som
      -- e-postarbetaren och webhooken publicerar.
      correlation_id      UUID NOT NULL,
      -- Monoton hos billing (domain.md #29). Här räcker CHECK:en; själva
      -- monotoniciteten upprätthålls av de villkorade UPDATE:erna i koden.
      status              TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'failed')),
      -- Leverantörens meddelande-id, satt när mejlet skickats. Webhooken
      -- slår upp raden på det här.
      provider_message_id TEXT,
      attempts            INTEGER NOT NULL DEFAULT 0,
      last_error          TEXT,
      next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at             TIMESTAMPTZ,
      delivered_at        TIMESTAMPTZ,
      failed_at           TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT email_outbox_natural_key UNIQUE (tenant_id, invoice_id, email_type)
    );
    CREATE INDEX email_outbox_tenant_id_idx ON email_outbox (tenant_id);
    -- Arbetaren plockar bara köade rader som är mogna att försöka igen.
    -- Partiellt så skanningen inte växer med hela historiken.
    CREATE INDEX email_outbox_pending_idx ON email_outbox (next_attempt_at)
      WHERE status = 'queued';
    -- Webhookens uppslag. UNIK (inte bara indexerad): det här id:t är
    -- GLOBALT över tenants (webhooken har ingen betrodd tenant, precis
    -- som email_webhook_events nedan) och är den ENDA nyckeln som avgör
    -- vilken tenants faktura en statusrapport gäller. Utan UNIQUE skulle
    -- två rader med samma id göra uppslaget odefinierat — fel tenants
    -- kund kan flaggas email_valid=false eller fel tenants faktura
    -- bounce:as (PR-granskning fas 4, punkt 10). Partiell: bara skickade
    -- rader har ett id.
    CREATE UNIQUE INDEX email_outbox_provider_message_id_key ON email_outbox (provider_message_id)
      WHERE provider_message_id IS NOT NULL;

    -- Dedup av inkommande leverantörs-event (planens Säkerhet: Webhooks #2).
    -- Global nyckel över tenants: en webhook som saknar betrodd tenant får
    -- inte kunna kringgå dedupen genom att härleda tenant annorlunda.
    CREATE TABLE email_webhook_events (
      provider    TEXT NOT NULL,
      event_id    TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (provider, event_id)
    );
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS email_webhook_events;
    DROP TABLE IF EXISTS email_outbox;
    DROP TABLE IF EXISTS documents;
  `);
};

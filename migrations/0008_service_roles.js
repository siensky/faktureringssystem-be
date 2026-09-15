/**
 * Fas 7 — härdning: separata Postgres-roller med GRANT bara på egna
 * tabeller (architecture.md, Tjänstegränser). "Klart när": payments får
 * ett rättighetsfel om den försöker skriva i invoices.
 *
 * Bara STRUKTUREN skapas här (roller + GRANT), aldrig lösenord — ett
 * lösenord hör inte hemma i en migration som aldrig ändras (database.md
 * #2) och måste gå att ROTERA utan en ny migration. Rollerna skapas
 * NOLOGIN; infra/postgres/init.sh sätter det faktiska LOGIN-lösenordet,
 * som en egen, om-körbar engångscontainer (samma mönster som
 * infra/rabbitmq/init.sh redan använder för RabbitMQ-kontona).
 *
 * Ingen GRANT skrivs bort med REVOKE: en nyskapad roll har per Postgres
 * standard NOLL rättigheter på andras tabeller (ägaren, migrationsanvändaren,
 * är den enda som har något förrän det uttryckligen grantas) — default-deny,
 * uttrycklig-allow är redan det säkra utgångsläget.
 *
 * Princip för vad som grantas:
 *   - EGNA tabeller (architecture.md:s ägandetabell): FULL DML (SELECT,
 *     INSERT, UPDATE, DELETE) oavsett exakt vad appkoden råkar göra idag —
 *     det är tjänstens egen data, ingen tjänstegränsrisk att vara frikostig
 *     där, och det slipper en ny migration för varje ny egen endpoint.
 *   - GEMENSAMMA tabeller (event_outbox, processed_events,
 *     idempotency_keys, audit_log) och det ENDA dokumenterade
 *     tjänstegränsundantaget (billing läser auths tenants): EXAKT det
 *     nuvarande koden faktiskt gör, inget mer — det är HÄR
 *     tjänstegränserna ska hålla, och över-grantande skulle sudda ut
 *     precis den isolering fas 7 finns för att bevisa.
 *
 * audit_log får INSERT och INGET annat, av NÅGON roll — ingen SELECT,
 * ingen UPDATE, ingen DELETE. Det är den databasgaranti som
 * migrations/0003_shared.js:s kommentar om append-only med "separata
 * roller i fas 7" syftar på.
 *
 * Se PR-beskrivningen för den fullständiga tabell-för-tabell-motiveringen
 * (en genomgången SQL-inventering av alla fyra tjänsters faktiska
 * SELECT/INSERT/UPDATE/DELETE), inklusive det medvetna, KVARSTÅENDE
 * undantaget: billing läser auths `tenants` direkt (isTenantActive,
 * listActiveTenantIds) eftersom en riktig tenant.suspended/reactivated-
 * händelse skulle kräva en avstängningsendpoint och en operatörsroll som
 * inte finns i någon av de 11 planerade faserna ännu.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    CREATE ROLE auth NOLOGIN;
    CREATE ROLE billing NOLOGIN;
    CREATE ROLE payments NOLOGIN;
    CREATE ROLE documents NOLOGIN;

    -- PG15 slutade ge PUBLIC CREATE på schemat "public" som standard, men
    -- USAGE (krävs för att SELECT/INSERT m.m. överhuvudtaget ska fungera)
    -- är fortfarande PUBLIC-default. Uttryckligt här ändå, i stället för
    -- att förlita sig på ett implicit PUBLIC-privilegium som kan hårdnas
    -- bort i en framtida Postgres-version.
    GRANT USAGE ON SCHEMA public TO auth, billing, payments, documents;

    -- ── auth: egna tabeller (architecture.md, Tjänstegränser) ──────────
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, users, user_tokens, service_clients TO auth;

    -- ── billing: egna tabeller ──────────────────────────────────────────
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      company_settings, customers, invoice_templates,
      invoices, invoice_items, invoice_snapshots, invoice_payments
      TO billing;

    -- ── payments: egna tabeller ─────────────────────────────────────────
    GRANT SELECT, INSERT, UPDATE, DELETE ON bank_transactions TO payments;

    -- ── documents: egna tabeller ────────────────────────────────────────
    GRANT SELECT, INSERT, UPDATE, DELETE ON documents, email_outbox, email_webhook_events TO documents;

    -- ── event_outbox: gemensam. Alla fyra publicerar (SELECT/UPDATE via
    -- startOutboxPublisher, INSERT via writeEvent). Bara billing raderar
    -- (automation/repository.ts:s cleanupPublishedOutbox, redan skopad i
    -- SQL på egna source_service-rader — se PR-beskrivningen för varför
    -- en tabellbred DELETE-rättighet ändå är rätt nivå: fas 7:s krav är
    -- GRANT per tabell, inte radnivå-säkerhet).
    GRANT SELECT, INSERT, UPDATE ON event_outbox TO auth, billing, payments, documents;
    GRANT DELETE ON event_outbox TO billing;

    -- ── processed_events: gemensam. Bara de tjänster som FAKTISKT
    -- konsumerar RabbitMQ-event (billing: deliveries+payments-konsumenterna;
    -- documents: invoice.sent/invoice.credited). auth och payments
    -- konsumerar aldrig något event.
    GRANT SELECT, INSERT ON processed_events TO billing, documents;

    -- ── idempotency_keys: gemensam, ingen ägande-kolumn (inte ens
    -- tenant-partitionerad mot en tjänst) — TTL:en är den enda sanningen,
    -- en utgången nyckel är död för alla tjänster lika (samma resonemang
    -- som automation/repository.ts:s cleanupExpiredIdempotencyKeys).
    -- billing äger POST /admin/invoices m.fl. och det dagliga städjobbet;
    -- payments äger POST /admin/payments/:id/match. auth och documents
    -- har ingen Idempotency-Key-skyddad endpoint.
    GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO billing;
    GRANT SELECT, INSERT, UPDATE ON idempotency_keys TO payments;

    -- ── audit_log: append-only DATABASGARANTI (migrations/0003_shared.js).
    -- INSERT och INGET annat, av någon roll. documents skriver aldrig hit.
    GRANT INSERT ON audit_log TO auth, billing, payments;

    -- ── Det ENA dokumenterade tjänstegränsundantaget: billing läser
    -- auths tenants.status direkt (isTenantActive, listActiveTenantIds).
    -- Se PR-beskrivningen för varför detta INTE går att stänga i fas 7.
    GRANT SELECT ON tenants TO billing;
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  // DROP ROLE ensam räcker inte — Postgres vägrar droppa en roll som
  // fortfarande har GRANT på några objekt ("role cannot be dropped
  // because some objects depend on it"). DROP OWNED BY river alla dess
  // rättigheter (och allt den eventuellt äger) FÖRST.
  pgm.sql(`
    DROP OWNED BY auth;
    DROP ROLE IF EXISTS auth;
    DROP OWNED BY billing;
    DROP ROLE IF EXISTS billing;
    DROP OWNED BY payments;
    DROP ROLE IF EXISTS payments;
    DROP OWNED BY documents;
    DROP ROLE IF EXISTS documents;
  `);
};

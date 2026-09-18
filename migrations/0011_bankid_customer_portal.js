/**
 * Fas 12 — BankID-igenkänning för kunder, tenant-övergripande.
 *
 * Bakgrund: ingen kod skapade tidigare någonsin en riktig BankID-
 * inloggningsidentitet för en kund (bara en testfixtur, se e2e/m2m.test.ts).
 * En sådan identitet kan nu höra till FLERA tenants samtidigt (en
 * privatperson kan vara kund hos flera företag i systemet), vilket bryter
 * två antaganden 0002_auth och 0009_portal byggde in:
 *
 *   1. users.tenant_id NOT NULL — en BankID-kundidentitet har ingen egen
 *      "hemma-tenant", bara länkar (user_company_links nedan). tenant_id
 *      blir därför valfri, men BARA för den formen (role='customer' AND
 *      auth_method='bankid') — users_tenant_shape garanterar det.
 *   2. users_customer_shape (0009): "(role='customer') = (customer_id IS
 *      NOT NULL)" antog en enda kund per inloggning. En BankID-
 *      kundidentitet bär inte customer_id på sin egen rad längre — den
 *      kopplingen (en per tenant) flyttar till user_company_links.
 *      Lösenordskunder (auth_method='password') är helt oförändrade.
 *
 * users_bankid_customer_pnr_hash_key gör uppslaget i
 * bankid/repository.ts deterministiskt: exakt en BankID-kundidentitet per
 * verkligt personnummer, aldrig en LIMIT 1 på en tvetydig träffmängd.
 *
 * user_company_links.customer_id -> customers(id) är ett tredje,
 * dokumenterat tjänstegränsundantag (samma familj som fas 9:s
 * users.customer_id -> customers, se architecture.md #2) — en BankID-
 * identitet hör till auth, men länken pekar in i billings kundtabell.
 * ON DELETE CASCADE på båda kolumnerna: försvinner tenanten eller kunden
 * (en kund utan fakturor FÅR raderas, domain.md #21) ska ingen föräldralös
 * länkrad bli kvar.
 *
 * down antar en tom/färsk databas (samma disciplin som CI:s
 * migrate-up-down-up, database.md #2) — går inte att köra tillbaka rent om
 * en BankID-kundidentitet redan finns, eftersom tenant_id då måste vara
 * NULL på just den raden.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;
    ALTER TABLE users ADD CONSTRAINT users_tenant_shape CHECK (
      (role = 'customer' AND auth_method = 'bankid') OR tenant_id IS NOT NULL
    );

    ALTER TABLE users DROP CONSTRAINT users_customer_shape;
    ALTER TABLE users ADD CONSTRAINT users_customer_shape CHECK (
      (role = 'customer' AND auth_method = 'password' AND customer_id IS NOT NULL)
      OR (role = 'customer' AND auth_method = 'bankid' AND customer_id IS NULL)
      OR (role = 'admin' AND customer_id IS NULL)
    );

    DROP INDEX users_pnr_hash_idx;
    CREATE INDEX users_pnr_hash_idx ON users (pnr_hash)
      WHERE pnr_hash IS NOT NULL AND role <> 'customer';
    CREATE UNIQUE INDEX users_bankid_customer_pnr_hash_key
      ON users (pnr_hash) WHERE auth_method = 'bankid' AND role = 'customer';

    CREATE TABLE user_company_links (
      id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      tenant_id    INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      customer_id  INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
      last_used_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, tenant_id),
      UNIQUE (tenant_id, customer_id)
    );
    CREATE INDEX user_company_links_user_id_idx ON user_company_links (user_id);

    -- Fas 7:s roll-per-tjänst (migrations/0008_service_roles.js) ger bara
    -- GRANT på tabeller som fanns då — en ny tabell ärver ingenting
    -- automatiskt. user_company_links hör till auth (architecture.md #2,
    -- tredje undantaget), precis som users/user_tokens.
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_company_links TO auth;
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS user_company_links;

    DROP INDEX IF EXISTS users_bankid_customer_pnr_hash_key;
    DROP INDEX IF EXISTS users_pnr_hash_idx;
    CREATE INDEX users_pnr_hash_idx ON users (pnr_hash) WHERE pnr_hash IS NOT NULL;

    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_shape;
    ALTER TABLE users ADD CONSTRAINT users_customer_shape CHECK (
      (role = 'customer') = (customer_id IS NOT NULL)
    );

    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_shape;
    ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
  `);
};

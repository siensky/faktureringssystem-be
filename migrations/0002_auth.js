/**
 * Fas 1 — auth: tenants, users, user_tokens, service_clients.
 *
 * database.md #16 (nyanserad i denna fas): TEXT + CHECK för värdemängder
 * som fortfarande kan röra sig (status, roll, token-typ), inte Postgres
 * ENUM som är trögt att ändra.
 *
 * customer_id på users hör till kundportalen (fas 4). Token-typen
 * 'customer_invite' finns med i CHECK:en redan nu — CHECK-värden går inte
 * att lägga till i efterhand utan DROP/ADD på en körd tabell (database.md
 * #2), samma skäl som event_outbox skrevs "färdig från början".
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE tenants (
      id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name        TEXT NOT NULL,
      org_number  TEXT NOT NULL UNIQUE,
      status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE users (
      id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id         INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      role              TEXT NOT NULL CHECK (role IN ('admin', 'customer')),
      auth_method       TEXT NOT NULL CHECK (auth_method IN ('password', 'bankid')),
      email             TEXT,
      password_hash     TEXT,
      pnr_hash          TEXT,
      email_verified_at TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- Lösenordsanvändare har e-post + hash; BankID-användare har pnr_hash.
      -- Databasen garanterar att en rad inte hamnar mittemellan.
      CONSTRAINT users_auth_shape CHECK (
        (auth_method = 'password' AND email IS NOT NULL AND password_hash IS NOT NULL)
        OR
        (auth_method = 'bankid' AND pnr_hash IS NOT NULL)
      )
    );

    -- E-post är globalt unik för inloggning (beslut fas 1): login slår upp
    -- användaren på e-post och läser tenant_id ur raden, eftersom det inte
    -- finns någon JWT att hämta tenant ur ännu. Partiellt så BankID-rader
    -- (email IS NULL) inte krockar med varandra.
    CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;
    CREATE INDEX users_tenant_id_idx ON users (tenant_id);
    CREATE INDEX users_pnr_hash_idx ON users (pnr_hash) WHERE pnr_hash IS NOT NULL;

    -- Refresh-tokens OCH engångstokens (verifiering, återställning). Alla
    -- lagras hashade, aldrig i klartext. used_at markerar förbrukning:
    -- för refresh sätts den vid rotation, för engångstokens vid användning.
    CREATE TABLE user_tokens (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_type  TEXT NOT NULL CHECK (token_type IN ('refresh', 'email_verification', 'password_reset', 'customer_invite')),
      token_hash  TEXT NOT NULL UNIQUE,
      expires_at  TIMESTAMPTZ NOT NULL,
      used_at     TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX user_tokens_lookup_idx ON user_tokens (user_id, token_type);
    CREATE INDEX user_tokens_expiry_idx ON user_tokens (expires_at);

    -- M2M-klienter. Tabellen skapas nu; POST /auth/token som använder den
    -- byggs i fas 2.
    CREATE TABLE service_clients (
      client_id           TEXT PRIMARY KEY,
      client_secret_hash  TEXT NOT NULL,
      allowed_scopes      TEXT[] NOT NULL DEFAULT '{}',
      description         TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS service_clients;
    DROP TABLE IF EXISTS user_tokens;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS tenants;
  `);
};

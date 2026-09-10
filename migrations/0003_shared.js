/**
 * Fas 1 — gemensamma tabeller som flera tjänster delar:
 * event_outbox, processed_events, idempotency_keys, audit_log.
 *
 * En tabell var, inte en per tjänst (architecture.md, Gemensamma tabeller).
 * source_service / consumer skiljer raderna åt.
 *
 * event_outbox får HELA kolumnuppsättningen redan nu (attempts,
 * next_attempt_at, failed_at, partiellt index) även om den fullständiga
 * publishern med exponentiell backoff och dead-letter-larm byggs i fas 3 —
 * en körd migration ändras aldrig (database.md #2), så tabellen skapas
 * färdig från början.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE event_outbox (
      event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_service  TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      tenant_id       INTEGER NOT NULL,
      correlation_id  UUID NOT NULL,
      payload         JSONB NOT NULL,
      occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      attempts        INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error      TEXT,
      published_at    TIMESTAMPTZ,
      failed_at       TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Publishern plockar bara opublicerade, icke-dead-letter-rader, sina
    -- egna, som är mogna att försöka igen. Partiellt så skanningen inte
    -- växer monotont med hela historiken.
    CREATE INDEX event_outbox_unpublished_idx
      ON event_outbox (source_service, next_attempt_at)
      WHERE published_at IS NULL AND failed_at IS NULL;

    CREATE TABLE processed_events (
      event_id     UUID NOT NULL,
      consumer     TEXT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (event_id, consumer)
    );

    -- Idempotens för skapande via API (fas 3). Tabellen skapas nu.
    CREATE TABLE idempotency_keys (
      tenant_id       INTEGER NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
      key             TEXT NOT NULL,
      endpoint        TEXT NOT NULL,
      request_hash    TEXT NOT NULL,
      state           TEXT NOT NULL CHECK (state IN ('in_progress', 'completed')),
      response_status INTEGER,
      response_body   JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, key)
    );

    -- Append-only granskningslogg. tenant_id nullbar: plattformsåtgärder
    -- (t.ex. tenant-avstängning innan en operatörsroll finns) har ingen
    -- tenant. Att den faktiskt är append-only (ingen UPDATE/DELETE-grant)
    -- görs till en databasgaranti med separata roller i fas 7.
    CREATE TABLE audit_log (
      id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id      INTEGER REFERENCES tenants (id) ON DELETE SET NULL,
      actor_user_id  INTEGER REFERENCES users (id) ON DELETE SET NULL,
      actor_service  TEXT,
      action         TEXT NOT NULL,
      resource_type  TEXT NOT NULL,
      resource_id    TEXT,
      correlation_id UUID,
      occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      metadata       JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, occurred_at);
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS audit_log;
    DROP TABLE IF EXISTS idempotency_keys;
    DROP TABLE IF EXISTS processed_events;
    DROP TABLE IF EXISTS event_outbox;
  `);
};

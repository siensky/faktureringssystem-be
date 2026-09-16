/**
 * Fas 9 — kundportal: users.customer_id.
 *
 * users.role och user_tokens.token_type ('customer_invite') fanns redan i
 * CHECK:en sedan 0002_auth (skriven "färdig från början", samma skäl som
 * event_outbox — database.md #2, en applicerad migration ändras aldrig).
 * Det som saknades är LÄNKEN till billings kundrad: en kundportal-inloggning
 * är en users-rad med role='customer' som pekar på en customers-rad.
 *
 * customer_id är en tjänstegränsöverskridande FK (users hör till auth,
 * customers till billing) — samma mönster som redan finns överallt annars
 * (customers.tenant_id -> auths tenants, invoices.customer_id -> customers
 * i samma tjänst). FK-kontrollen vid INSERT/UPDATE körs oavsett den
 * infogande rollens egna SELECT-rättigheter (Postgres RI-triggers, inte
 * sessionens ACL) så auth-rollen behöver INGEN ny GRANT i
 * migrations/0008_service_roles.js för att detta ska fungera.
 *
 * ON DELETE CASCADE: en kund utan fakturor FÅR raderas (domain.md #21) —
 * då ska inte en föräldralös portal-inloggning bli kvar. En kund MED
 * fakturor kan aldrig raderas (RESTRICT från invoices), så den vanliga
 * vägen hit är att kunden aldrig försvinner under en aktiv portalanvändare.
 *
 * users_customer_shape: exakt samma "databasen ska inte kunna hamna
 * mittemellan"-idé som users_auth_shape (0002) och customers_type_shape
 * (0004) — en admin-rad har aldrig customer_id, en kundportal-rad har
 * alltid ett.
 *
 * UNIQUE (partiellt på customer_id IS NOT NULL): en portal-inloggning per
 * kund (enkelhet — planen beskriver ingen flerpersonersinloggning per
 * kund, och service_clients/users-mönstret har inget annat att hänga
 * flera rader på).
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN customer_id INTEGER REFERENCES customers (id) ON DELETE CASCADE;

    ALTER TABLE users ADD CONSTRAINT users_customer_shape CHECK (
      (role = 'customer') = (customer_id IS NOT NULL)
    );

    CREATE UNIQUE INDEX users_customer_id_unique ON users (customer_id) WHERE customer_id IS NOT NULL;
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS users_customer_id_unique;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_shape;
    ALTER TABLE users DROP COLUMN IF EXISTS customer_id;
  `);
};

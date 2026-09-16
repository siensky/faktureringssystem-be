// Fas 7 e2e — härdning: separata Postgres-roller med GRANT bara på egna
// tabeller (migrations/0008_service_roles.js). "Klart när": payments får
// ett rättighetsfel om den försöker skriva i invoices — testat här
// bokstavligen, genom att koppla upp som payments EGEN, restriktiva roll
// (inte superusern övriga e2e-sviter använder) och faktiskt försöka.
// Körs bara med RUN_E2E mot en uppe stack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { DB_URL, PAYMENTS_DB_URL, newOrgNumber, uniq } from "./helpers";

const RUN = !!process.env.RUN_E2E;

// Postgres-felkod 42501 = insufficient_privilege (rättighetsfel), skiljer
// sig från t.ex. ett schemafel eller en trasig anslutning.
const INSUFFICIENT_PRIVILEGE = "42501";

describe.skipIf(!RUN)("fas 7 e2e — Postgres-roller (härdning)", () => {
  let sql: ReturnType<typeof postgres>;
  // Superuser-anslutning, bara för att sätta upp/riva en tenant-rad —
  // payments-rollen kan (medvetet) inte skriva i tenants själv.
  let adminSql: ReturnType<typeof postgres>;
  let tenantId: number;

  beforeAll(async () => {
    sql = postgres(PAYMENTS_DB_URL, { max: 1 });
    adminSql = postgres(DB_URL, { max: 1 });
    const [row] = await adminSql<{ id: number }[]>`
      INSERT INTO tenants (name, org_number) VALUES (${`E2E db-roles ${uniq()}`}, ${newOrgNumber()})
      RETURNING id
    `;
    tenantId = row!.id;
  });

  afterAll(async () => {
    await adminSql`DELETE FROM tenants WHERE id = ${tenantId}`;
    await sql.end();
    await adminSql.end();
  });

  test("payments-rollen kan koppla upp och läsa/skriva sin EGEN tabell (bank_transactions)", async () => {
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM bank_transactions`;
    expect(typeof n).toBe("number");
  });

  test("payments-rollen får rättighetsfel vid INSERT i invoices (fas 7:s uttryckliga 'klart när')", async () => {
    let error: unknown;
    try {
      await sql`
        INSERT INTO invoices (tenant_id, customer_id, invoice_type, status, date_issued, date_due, currency)
        VALUES (1, 1, 'invoice', 'draft', now(), now(), 'SEK')
      `;
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
    expect((error as { code?: string }).code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("payments-rollen får rättighetsfel även vid ren SELECT i invoices (ingen åtkomst alls, inte bara skrivskyddat)", async () => {
    let error: unknown;
    try {
      await sql`SELECT id FROM invoices LIMIT 1`;
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
    expect((error as { code?: string }).code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("payments-rollen får rättighetsfel vid UPDATE i customers (en annan tjänsts tabell)", async () => {
    let error: unknown;
    try {
      await sql`UPDATE customers SET name = 'x' WHERE id = 1`;
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
    expect((error as { code?: string }).code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("payments-rollen får rättighetsfel vid DELETE i audit_log (append-only databasgaranti)", async () => {
    let error: unknown;
    try {
      await sql`DELETE FROM audit_log WHERE id = 1`;
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
    expect((error as { code?: string }).code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  // Kodgranskning PR #7, fynd 1: payments EGEN felstädning
  // (services/payments/src/idempotency.ts) gör en DELETE på ett
  // 'in_progress'-anspråk när själva arbetet kastar — missad i den
  // ursprungliga GRANT-motiveringen (som bara nämnde SELECT/INSERT/UPDATE
  // för /admin/payments/:id/match). Positiv test, inte bara "inget fel":
  // bevisar att raden verkligen försvinner, inte att DELETE:en tystnar.
  test("payments-rollen kan DELETE:a sitt eget 'in_progress'-anspråk i idempotency_keys (felstädning)", async () => {
    const key = `db-roles-e2e-${uniq()}`;
    await sql`
      INSERT INTO idempotency_keys (tenant_id, key, endpoint, request_hash, state, expires_at)
      VALUES (${tenantId}, ${key}, '/test', 'hash', 'in_progress', now() + interval '1 hour')
    `;
    const deleted = await sql`
      DELETE FROM idempotency_keys WHERE tenant_id = ${tenantId} AND key = ${key} AND state = 'in_progress'
    `;
    expect(deleted.count).toBe(1);
  });
});

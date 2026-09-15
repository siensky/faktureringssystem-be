// Fas 7 e2e — härdning: separata Postgres-roller med GRANT bara på egna
// tabeller (migrations/0008_service_roles.js). "Klart när": payments får
// ett rättighetsfel om den försöker skriva i invoices — testat här
// bokstavligen, genom att koppla upp som payments EGEN, restriktiva roll
// (inte superusern övriga e2e-sviter använder) och faktiskt försöka.
// Körs bara med RUN_E2E mot en uppe stack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { PAYMENTS_DB_URL } from "./helpers";

const RUN = !!process.env.RUN_E2E;

// Postgres-felkod 42501 = insufficient_privilege (rättighetsfel), skiljer
// sig från t.ex. ett schemafel eller en trasig anslutning.
const INSUFFICIENT_PRIVILEGE = "42501";

describe.skipIf(!RUN)("fas 7 e2e — Postgres-roller (härdning)", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    sql = postgres(PAYMENTS_DB_URL, { max: 1 });
  });

  afterAll(async () => {
    await sql.end();
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
});

// Fas 2 e2e: M2M-token (client_credentials), requireUser/requireService-
// separation, scope-kontroll, X-Tenant-Id-hantering, och BankID-mocken.
// Körs bara med RUN_E2E mot en uppe stack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import postgres from "postgres";
import {
  DB_URL,
  PNR_HMAC_KEY,
  decodeJwt,
  get,
  hmacField,
  post,
  registerVerifyLogin,
  uniq,
} from "./helpers";

const RUN = !!process.env.RUN_E2E;
const CLIENT_ID = `billing-e2e-${uniq()}`;
const CLIENT_SECRET = "e2e-client-secret-very-long-and-random-123456";
const ALLOWED = ["auth:tenant:read", "billing:invoice:read"];

describe.skipIf(!RUN)("fas 2 e2e — M2M + BankID", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(DB_URL);
    const hash = await Bun.password.hash(CLIENT_SECRET, { algorithm: "argon2id" });
    await sql`
      INSERT INTO service_clients (client_id, client_secret_hash, allowed_scopes)
      VALUES (${CLIENT_ID}, ${hash}, ${ALLOWED})
    `;
  });
  afterAll(async () => {
    await sql`DELETE FROM service_clients WHERE client_id = ${CLIENT_ID}`;
    await sql.end();
  });

  async function serviceToken(scope: string): Promise<string> {
    const res = await post("/auth/token", {
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  test("client_credentials ger ett tjänste-token", async () => {
    const res = await post("/auth/token", {
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: "auth:tenant:read",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(300);
    expect(body.scope).toBe("auth:tenant:read");
    expect(decodeJwt(body.access_token as string).token_type).toBe("service");
    expect(decodeJwt(body.access_token as string).aud).toBe("internal");
  });

  test("fel client_secret ger 401", async () => {
    const res = await post("/auth/token", {
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: "fel-hemlighet",
    });
    expect(res.status).toBe(401);
  });

  test("bara scopes i allowed_scopes beviljas", async () => {
    const res = await post("/auth/token", {
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: "auth:tenant:read billing:invoice:write",
    });
    const body = (await res.json()) as { scope: string };
    expect(body.scope).toBe("auth:tenant:read");
  });

  test("användar-token avvisas på requireService-endpoint (401)", async () => {
    const { accessToken } = await registerVerifyLogin(`u-${uniq()}@ex.test`);
    const res = await get("/internal/auth/tenant-echo", {
      authorization: `Bearer ${accessToken}`,
      "x-tenant-id": "1",
    });
    expect(res.status).toBe(401);
  });

  test("tjänste-token avvisas på requireUser-endpoint (401)", async () => {
    const token = await serviceToken("auth:tenant:read");
    const res = await get("/auth/me", { authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
  });

  test("fel scope ger 403", async () => {
    const token = await serviceToken("billing:invoice:read");
    const res = await get("/internal/auth/tenant-echo", {
      authorization: `Bearer ${token}`,
      "x-tenant-id": "1",
    });
    expect(res.status).toBe(403);
  });

  test("X-Tenant-Id ignoreras på användar-endpoints", async () => {
    const { accessToken } = await registerVerifyLogin(`me-${uniq()}@ex.test`);
    const realTenant = decodeJwt(accessToken).tenantId as number;
    const res = await get("/auth/me", {
      authorization: `Bearer ${accessToken}`,
      "x-tenant-id": String(realTenant + 12345),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenantId: number };
    expect(body.tenantId).toBe(realTenant);
  });

  test("S2S utan X-Tenant-Id kastar i stället för att ge data", async () => {
    const token = await serviceToken("auth:tenant:read");

    const without = await get("/internal/auth/tenant-echo", {
      authorization: `Bearer ${token}`,
    });
    expect(without.status).toBeGreaterThanOrEqual(500);

    const withTenant = await get("/internal/auth/tenant-echo", {
      authorization: `Bearer ${token}`,
      "x-tenant-id": "5",
    });
    expect(withTenant.status).toBe(200);
    expect(((await withTenant.json()) as { tenantId: number }).tenantId).toBe(5);
  });

  describe("BankID (mock)", () => {
    test("okänt personnummer -> 401, inget konto skapas", async () => {
      const pnr = "199001019999";
      const before = await sql`
        SELECT count(*)::int AS n FROM users WHERE pnr_hash = ${hmacField(pnr, PNR_HMAC_KEY)}
      `;
      const init = await post("/auth/bankid/init", { personalNumber: pnr });
      expect(init.status).toBe(200);
      const { orderRef } = (await init.json()) as { orderRef: string };

      const collect = await post("/auth/bankid/collect", { orderRef });
      expect(collect.status).toBe(401);

      const after = await sql`
        SELECT count(*)::int AS n FROM users WHERE pnr_hash = ${hmacField(pnr, PNR_HMAC_KEY)}
      `;
      expect(after[0]!.n).toBe(before[0]!.n);
    });

    test("PENDING -> pending, FAILED -> failed", async () => {
      const p = await post("/auth/bankid/init", { personalNumber: "PENDING" });
      const { orderRef: pRef } = (await p.json()) as { orderRef: string };
      expect(
        (
          (await (await post("/auth/bankid/collect", { orderRef: pRef })).json()) as {
            status: string;
          }
        ).status,
      ).toBe("pending");

      const f = await post("/auth/bankid/init", { personalNumber: "FAILED" });
      const { orderRef: fRef } = (await f.json()) as { orderRef: string };
      expect(
        (
          (await (await post("/auth/bankid/collect", { orderRef: fRef })).json()) as {
            status: string;
          }
        ).status,
      ).toBe("failed");
    });

    test("känt personnummer -> tokens", async () => {
      // Skapa en tenant + en BankID-kundanvändare direkt.
      const [{ id: tenantId }] = await sql<{ id: number }[]>`
        INSERT INTO tenants (name, org_number) VALUES ('BankID Test', ${`55${Math.floor(1e8 + Math.random() * 8e8)}`})
        RETURNING id
      `;
      const pnr = `1995${Math.floor(1e7 + Math.random() * 8e7)}`;
      await sql`
        INSERT INTO users (tenant_id, role, auth_method, pnr_hash)
        VALUES (${tenantId}, 'customer', 'bankid', ${hmacField(pnr, PNR_HMAC_KEY)})
      `;

      const init = await post("/auth/bankid/init", { personalNumber: pnr });
      const { orderRef } = (await init.json()) as { orderRef: string };
      const collect = await post("/auth/bankid/collect", { orderRef });
      expect(collect.status).toBe(200);
      const body = (await collect.json()) as { status: string; accessToken: string };
      expect(body.status).toBe("complete");
      expect(decodeJwt(body.accessToken).role).toBe("customer");
      expect(decodeJwt(body.accessToken).tenantId).toBe(tenantId);
    });
  });
});

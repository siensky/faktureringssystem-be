// Fas 1 e2e: register -> verifiera -> login -> refresh -> logout, plus
// overifierad login (403), avstängd tenant (403), att tenantId i body inte
// kan påverka, och att tenant.created faktiskt når RabbitMQ via outboxen.
// Körs bara med RUN_E2E mot en uppe docker compose-stack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import amqplib from "amqplib";
import postgres from "postgres";
import { DB_URL, MQ_URL, PASSWORD, decodeJwt, get, newOrgNumber, post, uniq } from "./helpers";

const RUN = !!process.env.RUN_E2E;

describe.skipIf(!RUN)("auth fas 1 e2e", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    sql = postgres(DB_URL);
  });
  afterAll(async () => {
    await sql.end();
  });

  async function registerAndVerify(email: string) {
    const reg = await post("/auth/register", {
      companyName: `Bolag ${uniq()}`,
      orgNumber: newOrgNumber(),
      email,
      password: PASSWORD,
    });
    expect(reg.status).toBe(201);

    const tokenRes = await get(
      `/auth/dev/token?email=${encodeURIComponent(email)}&type=email_verification`,
    );
    expect(tokenRes.status).toBe(200);
    const { token } = (await tokenRes.json()) as { token: string };

    const verify = await post("/auth/verify-email", { token });
    expect(verify.status).toBe(200);
  }

  test("register -> verifiera -> login -> refresh -> logout", async () => {
    const email = `admin-${uniq()}@example.test`;
    await registerAndVerify(email);

    const login = await post("/auth/login", { email, password: PASSWORD });
    expect(login.status).toBe(200);
    const tokens = (await login.json()) as { accessToken: string; refreshToken: string };
    const claims = decodeJwt(tokens.accessToken);
    expect(claims.role).toBe("admin");
    expect(typeof claims.tenantId).toBe("number");
    expect(claims.token_type).toBe("access");
    expect(claims.aud).toBe("api");

    const refresh = await post("/auth/refresh", { refreshToken: tokens.refreshToken });
    expect(refresh.status).toBe(200);
    const rotated = (await refresh.json()) as { refreshToken: string };
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);

    const reused = await post("/auth/refresh", { refreshToken: tokens.refreshToken });
    expect(reused.status).toBe(401);

    const logout = await post("/auth/logout", { refreshToken: rotated.refreshToken });
    expect(logout.status).toBe(200);
    const afterLogout = await post("/auth/refresh", { refreshToken: rotated.refreshToken });
    expect(afterLogout.status).toBe(401);
  });

  test("GET /auth/me kräver token och returnerar rätt tenant/roll, 401 utan token", async () => {
    const email = `me-${uniq()}@example.test`;
    await registerAndVerify(email);
    const login = await post("/auth/login", { email, password: PASSWORD });
    const tokens = (await login.json()) as { accessToken: string };
    const claims = decodeJwt(tokens.accessToken);

    const me = await get("/auth/me", { authorization: `Bearer ${tokens.accessToken}` });
    expect(me.status).toBe(200);
    const body = (await me.json()) as {
      userId: number;
      tenantId: number;
      tenantName: string;
      email: string | null;
      role: string;
    };
    expect(body.tenantId).toBe(claims.tenantId);
    expect(body.role).toBe("admin");
    expect(body.email).toBe(email.toLowerCase());
    expect(typeof body.tenantName).toBe("string");

    expect((await get("/auth/me")).status).toBe(401);
  });

  test("login innan verifiering ger 403", async () => {
    const email = `overifierad-${uniq()}@example.test`;
    const reg = await post("/auth/register", {
      companyName: `Bolag ${uniq()}`,
      orgNumber: newOrgNumber(),
      email,
      password: PASSWORD,
    });
    expect(reg.status).toBe(201);
    expect((await post("/auth/login", { email, password: PASSWORD })).status).toBe(403);
  });

  test("tenantId i login-body ignoreras — tokenens tenant kommer ur användarraden", async () => {
    const email = `bodyinj-${uniq()}@example.test`;
    await registerAndVerify(email);

    const [{ tenant_id }] = await sql<{ tenant_id: number }[]>`
      SELECT tenant_id FROM users WHERE lower(email) = ${email.toLowerCase()}
    `;
    const otherTenant = tenant_id + 99999;

    const res = await post("/auth/login", { email, password: PASSWORD, tenantId: otherTenant });
    expect(res.status).toBe(200);
    const { accessToken } = (await res.json()) as { accessToken: string };
    expect(decodeJwt(accessToken).tenantId).toBe(tenant_id);
    expect(decodeJwt(accessToken).tenantId).not.toBe(otherTenant);
  });

  test("avstängd tenant kan inte logga in", async () => {
    const email = `suspended-${uniq()}@example.test`;
    await registerAndVerify(email);
    expect((await post("/auth/login", { email, password: PASSWORD })).status).toBe(200);

    await sql`
      UPDATE tenants SET status = 'suspended'
      WHERE id = (SELECT tenant_id FROM users WHERE lower(email) = ${email.toLowerCase()})
    `;
    expect((await post("/auth/login", { email, password: PASSWORD })).status).toBe(403);
  });

  test("forgot-password -> reset-password -> gammalt lösenord slutar fungera, refresh-tokens dödas", async () => {
    const email = `reset-${uniq()}@example.test`;
    await registerAndVerify(email);
    const first = (await (await post("/auth/login", { email, password: PASSWORD })).json()) as {
      refreshToken: string;
    };

    // forgot svarar alltid 200 (enumeringssäkert)
    expect((await post("/auth/forgot-password", { email })).status).toBe(200);
    const { token } = (await (
      await get(`/auth/dev/token?email=${encodeURIComponent(email)}&type=password_reset`)
    ).json()) as { token: string };

    const NEW_PASSWORD = "ett-helt-nytt-lösenord-9876";
    expect((await post("/auth/reset-password", { token, newPassword: NEW_PASSWORD })).status).toBe(
      200,
    );

    // Gammalt lösenord nekas, nytt fungerar
    expect((await post("/auth/login", { email, password: PASSWORD })).status).toBe(401);
    expect((await post("/auth/login", { email, password: NEW_PASSWORD })).status).toBe(200);
    // Refresh-token från före bytet är dött
    expect((await post("/auth/refresh", { refreshToken: first.refreshToken })).status).toBe(401);
    // Reset-token är engångs
    expect(
      (await post("/auth/reset-password", { token, newPassword: "återanvänt-1234567" })).status,
    ).toBe(400);
  });

  test("forgot-password för okänd e-post svarar likadant (enumeringssäkert)", async () => {
    const res = await post("/auth/forgot-password", { email: `finns-inte-${uniq()}@example.test` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("dubbelregistrering på samma e-post ger 201 utan andra tenant", async () => {
    const email = `dubbel-${uniq()}@example.test`;
    const org = newOrgNumber();
    const a = await post("/auth/register", {
      companyName: "Bolag A",
      orgNumber: org,
      email,
      password: PASSWORD,
    });
    expect(a.status).toBe(201);
    const before = await sql`SELECT count(*)::int AS n FROM tenants`;

    // Andra registreringen: samma e-post, annat orgnr -> fortfarande 201,
    // ingen ny tenant, ingen enumeringssignal via 500.
    const b = await post("/auth/register", {
      companyName: "Bolag B",
      orgNumber: newOrgNumber(),
      email,
      password: PASSWORD,
    });
    expect(b.status).toBe(201);
    const after = await sql`SELECT count(*)::int AS n FROM tenants`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  test("tenant.created når RabbitMQ via outboxen", async () => {
    const conn = await amqplib.connect(MQ_URL);
    const ch = await conn.createChannel();
    await ch.assertExchange("events", "topic", { durable: true });
    const q = await ch.assertQueue("", { exclusive: true, autoDelete: true });
    await ch.bindQueue(q.queue, "events", "tenant.created");

    const received: unknown[] = [];
    await ch.consume(q.queue, (m) => {
      if (m) {
        received.push(JSON.parse(m.content.toString("utf8")));
        ch.ack(m);
      }
    });

    await post("/auth/register", {
      companyName: `Bolag ${uniq()}`,
      orgNumber: newOrgNumber(),
      email: `outbox-${uniq()}@example.test`,
      password: PASSWORD,
    });

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && received.length === 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
    await ch.close();
    await conn.close();

    expect(received.length).toBeGreaterThan(0);
    const envelope = received[0] as { eventType: string; tenantId: number };
    expect(envelope.eventType).toBe("tenant.created");
    expect(typeof envelope.tenantId).toBe("number");
  });
});

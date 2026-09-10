// Fas 1 e2e: register -> verifiera -> login -> refresh -> logout, plus
// overifierad login (403), avstängd tenant (403), att tenantId i body inte
// kan påverka, och att tenant.created faktiskt når RabbitMQ via outboxen.
//
// Körs bara när RUN_E2E är satt (kräver en uppe docker compose-stack).
// unit-tests-jobbet i CI kör utan stack och hoppar då över hela filen.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import amqplib from "amqplib";
import postgres from "postgres";

const RUN = !!process.env.RUN_E2E;
const AUTH_URL = process.env.AUTH_URL ?? "http://localhost:4001";
const DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://sienna:changeme@localhost:5434/invoice_db";
const MQ_URL = process.env.E2E_RABBITMQ_URL ?? "amqp://admin:changeme@localhost:5672";

const PASSWORD = "korrekt-häst-batteri-häftklammer-1";

function api(path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  return fetch(`${AUTH_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
}

const uniq = () => Math.random().toString(36).slice(2, 10);

describe.skipIf(!RUN)("auth fas 1 e2e", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    sql = postgres(DB_URL);
  });
  afterAll(async () => {
    await sql.end();
  });

  async function registerAndVerify(email: string) {
    const reg = await api("/auth/register", {
      companyName: `Bolag ${uniq()}`,
      orgNumber: `55${Math.floor(1e8 + Math.random() * 8e8)}`,
      email,
      password: PASSWORD,
    });
    expect(reg.status).toBe(201);

    const tokenRes = await fetch(
      `${AUTH_URL}/auth/dev/token?email=${encodeURIComponent(email)}&type=email_verification`,
    );
    expect(tokenRes.status).toBe(200);
    const { token } = (await tokenRes.json()) as { token: string };

    const verify = await api("/auth/verify-email", { token });
    expect(verify.status).toBe(200);
  }

  test("register -> verifiera -> login -> refresh -> logout", async () => {
    const email = `admin-${uniq()}@example.test`;
    await registerAndVerify(email);

    const login = await api("/auth/login", { email, password: PASSWORD });
    expect(login.status).toBe(200);
    const tokens = (await login.json()) as { accessToken: string; refreshToken: string };
    const claims = decodeJwt(tokens.accessToken);
    expect(claims.role).toBe("admin");
    expect(typeof claims.tenantId).toBe("number");
    expect(claims.token_type).toBe("access");
    expect(claims.aud).toBe("api");

    const refresh = await api("/auth/refresh", { refreshToken: tokens.refreshToken });
    expect(refresh.status).toBe(200);
    const rotated = (await refresh.json()) as { refreshToken: string };
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);

    // Gammalt refresh-token är nu förbrukat -> återanvändning avvisas.
    const reused = await api("/auth/refresh", { refreshToken: tokens.refreshToken });
    expect(reused.status).toBe(401);

    const logout = await api("/auth/logout", { refreshToken: rotated.refreshToken });
    expect(logout.status).toBe(200);
    const afterLogout = await api("/auth/refresh", { refreshToken: rotated.refreshToken });
    expect(afterLogout.status).toBe(401);
  });

  test("login innan verifiering ger 403", async () => {
    const email = `overifierad-${uniq()}@example.test`;
    const reg = await api("/auth/register", {
      companyName: `Bolag ${uniq()}`,
      orgNumber: `55${Math.floor(1e8 + Math.random() * 8e8)}`,
      email,
      password: PASSWORD,
    });
    expect(reg.status).toBe(201);
    const login = await api("/auth/login", { email, password: PASSWORD });
    expect(login.status).toBe(403);
  });

  test("tenantId i login-body ignoreras — tokenens tenant kommer ur användarraden", async () => {
    const email = `bodyinj-${uniq()}@example.test`;
    await registerAndVerify(email);

    const [{ tenant_id }] = await sql<{ tenant_id: number }[]>`
      SELECT tenant_id FROM users WHERE lower(email) = ${email.toLowerCase()}
    `;
    const otherTenant = tenant_id + 99999;

    // Skicka med en påhittad tenantId i bodyn. Den ska inte kunna påverka
    // vilken tenant token utfärdas för.
    const res = await api("/auth/login", {
      email,
      password: PASSWORD,
      tenantId: otherTenant,
    });
    expect(res.status).toBe(200);
    const { accessToken } = (await res.json()) as { accessToken: string };
    expect(decodeJwt(accessToken).tenantId).toBe(tenant_id);
    expect(decodeJwt(accessToken).tenantId).not.toBe(otherTenant);
  });

  test("avstängd tenant kan inte logga in", async () => {
    const email = `suspended-${uniq()}@example.test`;
    await registerAndVerify(email);
    expect((await api("/auth/login", { email, password: PASSWORD })).status).toBe(200);

    await sql`
      UPDATE tenants SET status = 'suspended'
      WHERE id = (SELECT tenant_id FROM users WHERE lower(email) = ${email.toLowerCase()})
    `;
    const blocked = await api("/auth/login", { email, password: PASSWORD });
    expect(blocked.status).toBe(403);
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

    const email = `outbox-${uniq()}@example.test`;
    await api("/auth/register", {
      companyName: `Bolag ${uniq()}`,
      orgNumber: `55${Math.floor(1e8 + Math.random() * 8e8)}`,
      email,
      password: PASSWORD,
    });

    // Publishern pollar var ~1s.
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && received.length === 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
    await ch.close();
    await conn.close();

    expect(received.length).toBeGreaterThan(0);
    const envelope = received[0] as { eventType: string; tenantId: number; payload: unknown };
    expect(envelope.eventType).toBe("tenant.created");
    expect(typeof envelope.tenantId).toBe("number");
  });
});

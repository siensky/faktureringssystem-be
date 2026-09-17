// Delade hjälpare för e2e-sviterna. E2E är en svartlådeklient — den
// importerar inte tjänsternas interna paket.

import { createHmac } from "node:crypto";

export const AUTH_URL = process.env.AUTH_URL ?? "http://localhost:4001";
export const BILLING_URL = process.env.BILLING_URL ?? "http://localhost:4002";
export const DOCUMENTS_URL = process.env.DOCUMENTS_URL ?? "http://localhost:4004";
export const PAYMENTS_URL = process.env.PAYMENTS_URL ?? "http://localhost:4003";
export const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";
export const DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://sienna:changeme@localhost:5434/invoice_db";
// Fas 7: payments EGEN, restriktiva Postgres-roll (inte superusern ovan) —
// för att bevisa att GRANT:en i migrations/0008_service_roles.js faktiskt
// håller (e2e/db-roles.test.ts). Samma "changeme"-placeholder-mönster som
// DB_URL — måste överridas via env i en riktig miljö.
export const PAYMENTS_DB_URL =
  process.env.E2E_PAYMENTS_DATABASE_URL ??
  "postgresql://payments:changeme@localhost:5434/invoice_db";
export const MQ_URL = process.env.E2E_RABBITMQ_URL ?? "amqp://admin:changeme@localhost:5672";
export const EMAIL_WEBHOOK_SECRET =
  process.env.E2E_EMAIL_WEBHOOK_SECRET ?? "changeme-email-webhook";
export const PAYMENT_WEBHOOK_SECRET =
  process.env.E2E_PAYMENT_WEBHOOK_SECRET ?? "changeme-payment-webhook";
export const STRIPE_WEBHOOK_SECRET =
  process.env.E2E_STRIPE_WEBHOOK_SECRET ?? "changeme-stripe-webhook";
export const PNR_HMAC_KEY =
  process.env.E2E_PNR_HMAC_KEY ??
  "1111111111111111111111111111111111111111111111111111111111111111";
export const PNR_ENCRYPTION_KEY =
  process.env.E2E_PNR_ENCRYPTION_KEY ??
  "2222222222222222222222222222222222222222222222222222222222222222";

export const PASSWORD = "korrekt-häst-batteri-häftklammer-1";
export const uniq = () => Math.random().toString(36).slice(2, 10);

type Headers = Record<string, string>;

export function postTo(base: string, path: string, body: unknown, headers: Headers = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export function putTo(base: string, path: string, body: unknown, headers: Headers = {}) {
  return fetch(`${base}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export function delTo(base: string, path: string, headers: Headers = {}) {
  return fetch(`${base}${path}`, { method: "DELETE", headers });
}

export function getTo(base: string, path: string, headers: Headers = {}) {
  return fetch(`${base}${path}`, { headers });
}

export function post(path: string, body: unknown, headers: Headers = {}) {
  return postTo(AUTH_URL, path, body, headers);
}

export function get(path: string, headers: Headers = {}) {
  return getTo(AUTH_URL, path, headers);
}

export function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
}

export function newOrgNumber(): string {
  return `55${Math.floor(1e8 + Math.random() * 8e8)}`;
}

/** Luhn-kontrollsiffra så att `digits + retur` blir mod-10-giltigt. */
export function luhnCheck(digits: string): string {
  let sum = 0;
  let double = true; // sista siffran i `digits` dubblas när kontrollsiffran läggs till
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

/** Giltigt 12-siffrigt personnummer (Luhn över de 10 sista, rimligt datum). */
export function validPnr(): string {
  const day = String(1 + Math.floor(Math.random() * 27)).padStart(2, "0");
  const body = `19900${1 + Math.floor(Math.random() * 8)}${day}${Math.floor(
    100 + Math.random() * 900,
  )}`; // YYYYMMDDNNN, 11 siffror
  return body + luhnCheck(body.slice(2));
}

/** Giltigt 10-siffrigt organisationsnummer (Luhn mod-10). */
export function validOrgNumber(): string {
  const body = `556${Math.floor(100000 + Math.random() * 900000)}`; // 9 siffror
  return body + luhnCheck(body);
}

/** Giltigt 8-siffrigt bankgironummer (Luhn mod-10). */
export function validBankgiro(): string {
  const body = String(Math.floor(1000000 + Math.random() * 8000000)); // 7 siffror
  return body + luhnCheck(body);
}

/** Registrerar, verifierar och loggar in en admin. Returnerar token-paret. */
export async function registerVerifyLogin(email: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const reg = await post("/auth/register", {
    companyName: `Bolag ${uniq()}`,
    orgNumber: newOrgNumber(),
    email,
    password: PASSWORD,
  });
  if (reg.status !== 201) throw new Error(`register: ${reg.status}`);

  const tokRes = await get(
    `/auth/dev/token?email=${encodeURIComponent(email)}&type=email_verification`,
  );
  const { token } = (await tokRes.json()) as { token: string };
  await post("/auth/verify-email", { token });

  const login = await post("/auth/login", { email, password: PASSWORD });
  if (login.status !== 200) throw new Error(`login: ${login.status}`);
  return (await login.json()) as { accessToken: string; refreshToken: string };
}

/** Samma HMAC som packages/shared/src/crypto hmacField — inlinead så
 *  e2e-harnesset inte behöver @faktura/shared. */
export function hmacField(value: string, keyHex: string): string {
  return createHmac("sha256", Buffer.from(keyHex, "hex")).update(value, "utf8").digest("hex");
}

/**
 * Signaturen för POST /webhooks/email-status: HMAC-SHA256 (hex) över
 * "<timestamp>.<rå body>" med EMAIL_WEBHOOK_SECRET som nyckel (rå sträng,
 * inte hex) — speglar documents/src/documents/webhooks.py verify_signature.
 */
export function signEmailWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

/**
 * Signaturen för POST /webhooks/payment: samma "<timestamp>.<rå body>"-
 * konstruktion som signEmailWebhook, med PAYMENT_WEBHOOK_SECRET som
 * nyckel — speglar services/payments/src/webhooks/signature.ts.
 */
export function signPaymentWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

/**
 * Bygger en giltig "Stripe-Signature"-header för POST /webhooks/stripe —
 * Stripes RIKTIGA format ("t=<timestamp>,v1=<hex>"), inte de två separata
 * headers de andra webhookarna ovan använder. Speglar services/payments/
 * src/stripe/signature.ts:s buildStripeSignatureHeader, men inlinead
 * (e2e importerar inte tjänsternas interna paket, se filhuvudet).
 */
export function signStripeWebhook(secret: string, timestamp: string, body: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/** Pollar tills predicate() ger truthy eller deadline nås. Returnerar värdet. */
export async function until<T>(
  predicate: () => Promise<T | undefined | null | false>,
  { timeoutMs = 30000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("until(): tidsgräns nådd");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

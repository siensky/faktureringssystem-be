// Delade hjälpare för e2e-sviterna. E2E är en svartlådeklient — den
// importerar inte tjänsternas interna paket.

import { createHmac } from "node:crypto";

export const AUTH_URL = process.env.AUTH_URL ?? "http://localhost:4001";
export const BILLING_URL = process.env.BILLING_URL ?? "http://localhost:4002";
export const DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://sienna:changeme@localhost:5434/invoice_db";
export const MQ_URL = process.env.E2E_RABBITMQ_URL ?? "amqp://admin:changeme@localhost:5672";
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

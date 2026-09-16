// All billing-specifik konfiguration läses EN gång här och valideras vid
// uppstart (code-style.md #28). Saknas en obligatorisk variabel kraschar
// tjänsten direkt med ett tydligt fel i stället för att falla på första
// requesten som råkar behöva den.

import { loadEnv, loadEnvWithDefaults, parseIntEnv } from "@faktura/shared";

const required = loadEnv([
  "DATABASE_URL",
  "RABBITMQ_URL",
  "REDIS_URL",
  // Verifierar användar-JWT (aud: api) respektive tjänste-JWT (aud: internal).
  // Separata hemligheter per token-klass (planens Säkerhet-avsnitt).
  "JWT_USER_SECRET",
  "JWT_SERVICE_SECRET",
  // Personnummer för privatkunder: krypteras (AES-GCM) + HMAC:as för
  // uppslag. Två SKILDA nycklar, båda 64 hex (planens Personnummer-avsnitt).
  "PNR_ENCRYPTION_KEY",
  "PNR_HMAC_KEY",
  // Fas 7: GET /internal/ops/alerts anropar payments EGNA drift-endpoint
  // (unknown-bankgiro) S2S i stället för att läsa dess tabell direkt
  // (architecture.md #2) — samma mönster som payments BILLING_BASE_URL/
  // PAYMENTS_CLIENT_ID (services/payments/src/config.ts).
  "AUTH_BASE_URL",
  "PAYMENTS_BASE_URL",
  "BILLING_CLIENT_ID",
  "BILLING_CLIENT_SECRET",
] as const);

const optional = loadEnvWithDefaults({
  PORT: "4002",
  CORS_ORIGIN: "http://localhost:5173",
  NODE_ENV: "development",
  // Minsta möjliga scope (architecture.md #18): billing anropar bara
  // payments unknown-bankgiro-drifts vy.
  BILLING_CLIENT_SCOPES: "payments:ops:read",
});

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export const config = {
  port: parseIntEnv("PORT", optional.PORT),
  corsOrigins: optional.CORS_ORIGIN.split(",").map((o) => o.trim()),
  databaseUrl: required.DATABASE_URL,
  rabbitmqUrl: required.RABBITMQ_URL,
  redisUrl: required.REDIS_URL,
  jwtUserSecret: required.JWT_USER_SECRET,
  jwtServiceSecret: required.JWT_SERVICE_SECRET,
  pnrEncryptionKey: required.PNR_ENCRYPTION_KEY,
  pnrHmacKey: required.PNR_HMAC_KEY,
  authBaseUrl: trimTrailingSlash(required.AUTH_BASE_URL),
  paymentsBaseUrl: trimTrailingSlash(required.PAYMENTS_BASE_URL),
  billingClientId: required.BILLING_CLIENT_ID,
  billingClientSecret: required.BILLING_CLIENT_SECRET,
  billingClientScopes: optional.BILLING_CLIENT_SCOPES.split(/\s+/).filter(Boolean),
  isProduction: optional.NODE_ENV === "production",
} as const;

export const SERVICE_NAME = "billing";

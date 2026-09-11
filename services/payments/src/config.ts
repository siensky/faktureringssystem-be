// All payments-specifik konfiguration läses EN gång här och valideras vid
// uppstart (code-style.md #28) — samma mönster som billings config.ts.
// Saknas en obligatorisk variabel kraschar tjänsten direkt i stället för
// att falla på första requesten som råkar behöva den.

import { loadEnv, loadEnvWithDefaults, parseIntEnv } from "@faktura/shared";

const required = loadEnv([
  "DATABASE_URL",
  "RABBITMQ_URL",
  "REDIS_URL",
  // Verifierar användar-JWT (aud: api) för /admin/payments/*, respektive
  // tjänste-JWT (aud: internal) för /internal/*. Separata hemligheter per
  // token-klass (planens Säkerhet-avsnitt).
  "JWT_USER_SECRET",
  "JWT_SERVICE_SECRET",
  // HMAC-hemlighet för POST /webhooks/payment. Signaturen räknas över RÅ
  // body (domain.md #25).
  "PAYMENT_WEBHOOK_SECRET",
  // S2S mot billing (bankgiro->tenant, OCR/id->faktura) och auth
  // (tjänste-token).
  "BILLING_BASE_URL",
  "AUTH_BASE_URL",
  "PAYMENTS_CLIENT_ID",
  "PAYMENTS_CLIENT_SECRET",
] as const);

const optional = loadEnvWithDefaults({
  PORT: "4003",
  CORS_ORIGIN: "http://localhost:5173",
  // Minsta möjliga scope (architecture.md #18): billing-client anropar
  // bara by-bankgiro, by-ocr och invoices/:id/current.
  PAYMENTS_CLIENT_SCOPES: "billing:company:read billing:invoice:read",
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
  paymentWebhookSecret: required.PAYMENT_WEBHOOK_SECRET,
  billingBaseUrl: trimTrailingSlash(required.BILLING_BASE_URL),
  authBaseUrl: trimTrailingSlash(required.AUTH_BASE_URL),
  paymentsClientId: required.PAYMENTS_CLIENT_ID,
  paymentsClientSecret: required.PAYMENTS_CLIENT_SECRET,
  paymentsClientScopes: optional.PAYMENTS_CLIENT_SCOPES.split(/\s+/).filter(Boolean),
} as const;

export const SERVICE_NAME = "payments";

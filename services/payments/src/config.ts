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
  // Fas 10: HMAC-hemlighet för POST /webhooks/stripe. Krävs ALLTID (även
  // med STRIPE_PROVIDER=mock) — e2e simulerar ett Stripe-event signerat
  // med samma hemlighet, ingen nätverksåtkomst eller riktigt Stripe-konto
  // behövs för att verifiera (services/payments/src/stripe/signature.ts).
  "STRIPE_WEBHOOK_SECRET",
  // Bas-URL till apps/portal — success_url/cancel_url på Checkout-sessionen
  // pekar hit.
  "PORTAL_BASE_URL",
] as const);

const optional = loadEnvWithDefaults({
  PORT: "4003",
  CORS_ORIGIN: "http://localhost:5173",
  NODE_ENV: "development",
  // Minsta möjliga scope (architecture.md #18): billing-client anropar
  // bara by-bankgiro, by-ocr och invoices/:id/current.
  PAYMENTS_CLIENT_SCOPES: "billing:company:read billing:invoice:read",
  // Fas 10 (architecture.md #25, mock-undantaget — samma mönster som
  // BANKID_PROVIDER i services/auth/src/config.ts): "mock" i dev/CI,
  // "real" mot Stripes riktiga testläges-API. STRIPE_SECRET_KEY krävs
  // bara i "real"-läget, se produktionsspärren nedan.
  STRIPE_PROVIDER: "mock",
  STRIPE_SECRET_KEY: "",
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
  isProduction: optional.NODE_ENV === "production",
  stripeWebhookSecret: required.STRIPE_WEBHOOK_SECRET,
  portalBaseUrl: trimTrailingSlash(required.PORTAL_BASE_URL),
  stripeProvider: optional.STRIPE_PROVIDER,
  stripeSecretKey: optional.STRIPE_SECRET_KEY,
} as const;

// Samma disciplin som BANKID_PROVIDER (services/auth/src/config.ts):
// mocken är en total genväg förbi ett riktigt betalkort, och FÅR ALDRIG
// köras i produktion. "real" utan en nyckel kan heller aldrig fungera,
// oavsett miljö — kraschar direkt i stället för att falla på första
// betalningsförsöket.
if (config.isProduction && config.stripeProvider !== "real") {
  throw new Error("STRIPE_PROVIDER måste vara 'real' i produktion — mocken är en total genväg");
}
if (config.stripeProvider === "real" && !config.stripeSecretKey) {
  throw new Error("STRIPE_SECRET_KEY krävs när STRIPE_PROVIDER=real");
}

export const SERVICE_NAME = "payments";

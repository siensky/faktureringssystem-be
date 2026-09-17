// All auth-specifik konfiguration läses EN gång här och valideras vid
// uppstart (code-style.md #28). Saknas en obligatorisk variabel kraschar
// tjänsten direkt med ett tydligt fel i stället för att falla på första
// requesten som råkar behöva den.

import { loadEnv, loadEnvWithDefaults, parseIntEnv } from "@faktura/shared";

const required = loadEnv([
  "DATABASE_URL",
  "RABBITMQ_URL",
  "REDIS_URL",
  "JWT_USER_SECRET",
  "JWT_SERVICE_SECRET",
  "AUTH_TOKEN_PEPPER",
  "PNR_HMAC_KEY",
  // Fas 9: POST /auth/customer-invites validerar customerId mot billing
  // S2S (GET /internal/customers/:id, scope billing:customer:read) i
  // stället för att lita blint på en admins body — samma mönster som
  // payments BILLING_BASE_URL/PAYMENTS_CLIENT_ID (services/payments/src/
  // config.ts). Ingen S2S-write (architecture.md #20): auth skriver bara i
  // sina egna tabeller, den här läsningen är bara en existens-/tenant-koll.
  // AUTH_BASE_URL pekar på auth SJÄLV — den behöver ett eget tjänste-token
  // (POST /auth/token) precis som vilken annan klient som helst för att
  // hålla scope-beviljandet i service_clients som den enda sanningen
  // (i stället för att auth genvägssignerar sitt eget token förbi den
  // kontrollen).
  "BILLING_BASE_URL",
  "AUTH_BASE_URL",
  "AUTH_CLIENT_ID",
  "AUTH_CLIENT_SECRET",
] as const);

const optional = loadEnvWithDefaults({
  PORT: "4001",
  CORS_ORIGIN: "http://localhost:5173",
  NODE_ENV: "development",
  AUTH_DEV_ENDPOINTS: "false",
  REFRESH_TTL_DAYS: "30",
  EMAIL_VERIFICATION_TTL_HOURS: "24",
  PASSWORD_RESET_TTL_HOURS: "1",
  CUSTOMER_INVITE_TTL_DAYS: "7",
  AUTH_STRICT_RATE_LIMIT_MAX: "10",
  BANKID_PROVIDER: "mock",
  // Fas 11: BankIDs egen, publika (icke-hemliga) adress för RP-API v6.1
  // mot testmiljön. Bara relevant när BANKID_PROVIDER=real.
  BANKID_BASE_URL: "https://appapi2.test.bankid.com/rp/v6.1",
  // Klientcertifikat (P12) + CA-rot för mutual TLS mot BankID. Filsökvägar,
  // inte innehållet — certifikaten committas ALDRIG (git.md #9). Tomma i
  // mock-läge.
  BANKID_CERT_PATH: "",
  BANKID_CERT_PASSPHRASE: "",
  BANKID_CA_PATH: "",
  // Minsta möjliga scope (architecture.md #18): auth anropar bara
  // GET /internal/customers/:id.
  AUTH_CLIENT_SCOPES: "billing:customer:read",
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
  tokenPepper: required.AUTH_TOKEN_PEPPER,
  pnrHmacKey: required.PNR_HMAC_KEY,
  isProduction: optional.NODE_ENV === "production",
  // Dev-endpoints (t.ex. att hämta en verifieringstoken utan mejl) kräver
  // BÅDE att vi inte är i produktion OCH en explicit flagga — samma
  // disciplin som seed-scriptet (code-style.md #24).
  devEndpointsEnabled: optional.NODE_ENV !== "production" && optional.AUTH_DEV_ENDPOINTS === "true",
  refreshTtlSeconds: parseIntEnv("REFRESH_TTL_DAYS", optional.REFRESH_TTL_DAYS) * 24 * 60 * 60,
  emailVerificationTtlSeconds:
    parseIntEnv("EMAIL_VERIFICATION_TTL_HOURS", optional.EMAIL_VERIFICATION_TTL_HOURS) * 60 * 60,
  passwordResetTtlSeconds:
    parseIntEnv("PASSWORD_RESET_TTL_HOURS", optional.PASSWORD_RESET_TTL_HOURS) * 60 * 60,
  customerInviteTtlSeconds:
    parseIntEnv("CUSTOMER_INVITE_TTL_DAYS", optional.CUSTOMER_INVITE_TTL_DAYS) * 24 * 60 * 60,
  // Hårt per-IP-tak på känsliga endpoints (login, register, reset). Lågt
  // som standard; höjs i test/CI där hela sviten kör från samma IP.
  strictRateLimitMax: parseIntEnv(
    "AUTH_STRICT_RATE_LIMIT_MAX",
    optional.AUTH_STRICT_RATE_LIMIT_MAX,
  ),
  bankIdProvider: optional.BANKID_PROVIDER,
  bankIdBaseUrl: trimTrailingSlash(optional.BANKID_BASE_URL),
  bankIdCertPath: optional.BANKID_CERT_PATH,
  bankIdCertPassphrase: optional.BANKID_CERT_PASSPHRASE,
  bankIdCaPath: optional.BANKID_CA_PATH,
  billingBaseUrl: trimTrailingSlash(required.BILLING_BASE_URL),
  authBaseUrl: trimTrailingSlash(required.AUTH_BASE_URL),
  authClientId: required.AUTH_CLIENT_ID,
  authClientSecret: required.AUTH_CLIENT_SECRET,
  authClientScopes: optional.AUTH_CLIENT_SCOPES.split(/\s+/).filter(Boolean),
} as const;

// BankID-mocken tar personnumret ur request-bodyn och returnerar det som
// signerat — total auth-bypass. Den får ALDRIG köras i produktion. Samma
// disciplin som dev-endpoints.
if (config.isProduction && config.bankIdProvider !== "real") {
  throw new Error(
    "BANKID_PROVIDER måste vara 'real' i produktion — mocken är en total auth-bypass",
  );
}
// "real" utan certifikat kan aldrig fungera, oavsett miljö — kraschar
// direkt i stället för att falla på första BankID-inloggningen (samma
// disciplin som STRIPE_PROVIDER=real i services/payments/src/config.ts).
if (config.bankIdProvider === "real" && (!config.bankIdCertPath || !config.bankIdCaPath)) {
  throw new Error("BANKID_CERT_PATH och BANKID_CA_PATH krävs när BANKID_PROVIDER=real");
}

export const SERVICE_NAME = "auth";

// All auth-specifik konfiguration läses EN gång här och valideras vid
// uppstart (code-style.md #26). Saknas en obligatorisk variabel kraschar
// tjänsten direkt med ett tydligt fel i stället för att falla på första
// requesten som råkar behöva den.

import { loadEnv, loadEnvWithDefaults, parseIntEnv } from "@faktura/shared";

const required = loadEnv([
  "DATABASE_URL",
  "RABBITMQ_URL",
  "REDIS_URL",
  "JWT_USER_SECRET",
  "AUTH_TOKEN_PEPPER",
] as const);

const optional = loadEnvWithDefaults({
  PORT: "4001",
  CORS_ORIGIN: "http://localhost:5173",
  NODE_ENV: "development",
  AUTH_DEV_ENDPOINTS: "false",
  REFRESH_TTL_DAYS: "30",
  EMAIL_VERIFICATION_TTL_HOURS: "24",
  PASSWORD_RESET_TTL_HOURS: "1",
  AUTH_STRICT_RATE_LIMIT_MAX: "10",
});

export const config = {
  port: parseIntEnv("PORT", optional.PORT),
  corsOrigins: optional.CORS_ORIGIN.split(",").map((o) => o.trim()),
  databaseUrl: required.DATABASE_URL,
  rabbitmqUrl: required.RABBITMQ_URL,
  redisUrl: required.REDIS_URL,
  jwtUserSecret: required.JWT_USER_SECRET,
  tokenPepper: required.AUTH_TOKEN_PEPPER,
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
  // Hårt per-IP-tak på känsliga endpoints (login, register, reset). Lågt
  // som standard; höjs i test/CI där hela sviten kör från samma IP.
  strictRateLimitMax: parseIntEnv(
    "AUTH_STRICT_RATE_LIMIT_MAX",
    optional.AUTH_STRICT_RATE_LIMIT_MAX,
  ),
} as const;

export const SERVICE_NAME = "auth";

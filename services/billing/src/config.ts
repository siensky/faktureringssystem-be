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
] as const);

const optional = loadEnvWithDefaults({
  PORT: "4002",
  CORS_ORIGIN: "http://localhost:5173",
  NODE_ENV: "development",
});

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
  isProduction: optional.NODE_ENV === "production",
} as const;

export const SERVICE_NAME = "billing";

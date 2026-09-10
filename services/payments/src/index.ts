// payments-tjänsten. Fas 0: allt gemensamt (health, RabbitMQ + system-ping,
// CORS/helmet/bodyLimit/rate limiting, felhanterare) ligger i
// startService() i @faktura/shared. Den här filen läser bara env och
// startar. Affärslogik och egna routes tillkommer i respektive fas via
// `configure`-hooken (code-style.md #2).

import {
  createLogger,
  loadEnv,
  loadEnvWithDefaults,
  parseIntEnv,
  startService,
} from "@faktura/shared";

const SERVICE_NAME = "payments";
const logger = createLogger(SERVICE_NAME);

// Kraschar direkt vid uppstart om något saknas — hellre ett tydligt fel i
// loggen vid start än en tjänst som faller på första anropet (code-style.md #26).
const env = loadEnv(["RABBITMQ_URL", "REDIS_URL"] as const);
const { PORT, CORS_ORIGIN } = loadEnvWithDefaults({
  PORT: "4003",
  CORS_ORIGIN: "http://localhost:5173",
});

startService({
  serviceName: SERVICE_NAME,
  port: parseIntEnv("PORT", PORT),
  rabbitmqUrl: env.RABBITMQ_URL,
  redisUrl: env.REDIS_URL,
  corsOrigins: CORS_ORIGIN.split(",").map((origin) => origin.trim()),
  logger,
}).catch((error) => {
  logger.error({ err: error }, `${SERVICE_NAME} misslyckades att starta`);
  process.exit(1);
});

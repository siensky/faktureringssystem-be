// auth-tjänsten. Fas 0: bara fundamentet — health, RabbitMQ-
// anslutning med system-ping, och skyddsmekanismerna (CORS, helmet, body
// limit, grov rate limiting) som all affärslogik i senare faser byggs
// ovanpå. Ingen affärslogik hör hemma här (code-style.md #2) — bara
// bootstrap.

import {
  connectRabbitMQ,
  createLogger,
  createRedisClient,
  loadEnv,
  loadEnvWithDefaults,
  parseIntEnv,
  registerErrorHandler,
  registerHealthRoutes,
  startSystemPing,
} from "@faktura/shared";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";

const SERVICE_NAME = "auth";
const DEFAULT_PORT = "4001";

const logger = createLogger(SERVICE_NAME);

// Kraschar direkt vid uppstart om RABBITMQ_URL saknas — hellre ett tydligt
// fel i loggen vid start än en tjänst som startar och sedan faller på
// första anropet som råkar behöva den (code-style.md #26).
const requiredEnv = loadEnv(["RABBITMQ_URL", "REDIS_URL"] as const);
const { PORT, CORS_ORIGIN } = loadEnvWithDefaults({
  PORT: DEFAULT_PORT,
  CORS_ORIGIN: "http://localhost:5173",
});

async function start() {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: false,
    // 256 KB som standard (planens "Säkerhet: Transportnära grunder").
    // Endpoints som faktiskt behöver mer (filimport i payments) höjer det
    // per route, inte globalt.
    bodyLimit: 256 * 1024,
  });

  // Aldrig "*" när Authorization/cookies är med — CORS_ORIGIN är en
  // kommaseparerad lista per miljö, satt i docker-compose/.env.
  await app.register(cors, { origin: CORS_ORIGIN.split(",").map((o) => o.trim()) });
  await app.register(helmet);

  // Räknaren ligger i Redis, inte i minnet — annars ger tre repliker av
  // samma tjänst tre gånger så många försök innan någon blockeras (se
  // Beslut-tabellen: Redis används just för rate limiting-räknare).
  // Detta är det GROVA globala taket per instans; hårdare, kontospecifik
  // strypning på känsliga endpoints (login, BankID-init) läggs till i
  // fas 1/2 — se planens "Säkerhet: Rate limiting".
  const redis = createRedisClient(requiredEnv.REDIS_URL);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute", redis });

  registerErrorHandler(app, logger);

  const rabbit = await connectRabbitMQ(requiredEnv.RABBITMQ_URL);

  const pingState = await startSystemPing(rabbit.channel, SERVICE_NAME, (msg) => {
    logger.info({ from: msg.service }, "mottog system.ping");
  });

  registerHealthRoutes(app, [
    {
      name: "rabbitmq",
      check: async () => {
        // amqplib har inget synkront "är den öppen"-API som är helt
        // pålitligt över tid, men channel.connection.connection sätts till
        // null av biblioteket när anslutningen stängts av servern.
        if ((rabbit.connection as any).connection === null) {
          throw new Error("RabbitMQ-anslutningen är stängd");
        }
      },
    },
    {
      name: "redis",
      check: async () => {
        await redis.ping();
      },
    },
  ]);

  // Tillfällig debug-endpoint för fas 0 — bevisar att ping-eventet faktiskt
  // gått runt till alla fyra tjänsterna. Tas bort när riktiga affärsevent
  // finns att verifiera mot i stället.
  app.get("/internal/debug/pings-seen", async () => ({ seen: [...pingState.seen] }));

  app.addHook("onClose", async () => {
    await rabbit.close();
    redis.disconnect();
  });

  const port = parseIntEnv("PORT", PORT);
  await app.listen({ host: "0.0.0.0", port });
  logger.info({ port }, `${SERVICE_NAME} lyssnar`);
}

start().catch((error) => {
  logger.error({ err: error }, `${SERVICE_NAME} misslyckades att starta`);
  process.exit(1);
});

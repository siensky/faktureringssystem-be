// Delad Fastify-bootstrap för auth/billing/payments. Fas 0 hade tre nästan
// identiska index.ts — allt det gemensamma (CORS, helmet, bodyLimit, Redis-
// baserad rate limiting, felhanterare, /health/*, system-ping) bor här i
// stället (code-style.md #27, #29). Varje tjänsts index.ts blir då bara
// "läs env, anropa startService, registrera dina egna routes".

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { loadEnvWithDefaults, parseIntEnv } from "../config";
import { registerErrorHandler } from "../errors/handler";
import { type ReadinessCheck, registerHealthRoutes } from "../health";
import { startSystemPing } from "../ping";
import { type RabbitConnection, connectRabbitMQ } from "../rabbitmq";
import { createRedisClient } from "../redis";

// Att skicka in en egen pino-instans som `loggerInstance` gör att Fastify
// härleder en annan konkret Logger-generic än sin default, och den exakta
// typen är irrelevant för kod som bara registrerar routes och plugins —
// samma "any" som i health/index.ts och errors/handler.ts (code-style.md #16).
type AnyFastify = FastifyInstance<any, any, any, any, any>;

// 256 KB som standard (planens "Säkerhet: Transportnära grunder"). Endpoints
// som faktiskt behöver mer (filimport i payments, fas 5) höjer det per
// route, inte globalt.
const DEFAULT_BODY_LIMIT = 256 * 1024;

// Grovt globalt tak per instans. Hårdare, kontospecifik strypning på
// känsliga endpoints (login, BankID-init) läggs till i fas 1/2 — se planens
// "Säkerhet: Rate limiting". Räknaren ligger i Redis så att flera repliker
// delar den.
//
// Överbagbar via RATE_LIMIT_MAX — samma mönster som auths
// AUTH_STRICT_RATE_LIMIT_MAX (services/auth/src/config.ts): produktion
// behåller det säkra defaultvärdet, men CI/e2e sätter ett högre tak i
// .env/.github/workflows/ci.yml. Den här gränsen är avsiktligt en trubbig
// missbruksspärr, inte en precisionsjusterad säkerhetsgräns (den
// finkorniga, per-konto-strypningen sitter någon annanstans) — en växande
// e2e-svit (fem sviter från och med fas 5) är legitim trafik som gränsen
// måste växa med, inte ett hål att stänga (PR-granskning fas 5,
// CI-verifiering: en enda kall körning av hela e2e-sviten i CI kunde
// annars träffa 300/min bara på legitim testtrafik).
const rateLimitMaxEnv = loadEnvWithDefaults({ RATE_LIMIT_MAX: "300" });
const RATE_LIMIT_MAX = parseIntEnv("RATE_LIMIT_MAX", rateLimitMaxEnv.RATE_LIMIT_MAX);
const RATE_LIMIT_WINDOW = "1 minute";

export interface StartServiceOptions {
  serviceName: string;
  port: number;
  rabbitmqUrl: string;
  redisUrl: string;
  /** Explicit origin-lista, aldrig "*" när Authorization/cookies är med. */
  corsOrigins: string[];
  logger: Logger;
  /**
   * Antal proxy-hopp att lita på för `request.ip` / X-Forwarded-For.
   * nginx är enda proxyn framför tjänsterna, så default `1`. Utan detta
   * blir `request.ip` = nginx-containerns IP för ALL trafik, och varje
   * per-IP-gräns kollapsar till ett globalt tak. Sätt `0` om tjänsten
   * körs utan proxy.
   */
  trustProxyHops?: number;
  /** Readiness-checkar utöver de inbyggda (rabbitmq, redis). */
  extraReadinessChecks?: ReadinessCheck[];
  /**
   * Registrera tjänstens egna routes/plugins. Får Fastify-instansen och de
   * delade klienterna. Körs efter att bas-plugins registrerats men innan
   * servern börjar lyssna.
   */
  configure?: (app: AnyFastify, ctx: ServiceContext) => Promise<void> | void;
}

export interface ServiceContext {
  redis: ReturnType<typeof createRedisClient>;
  rabbit: RabbitConnection;
  logger: Logger;
}

export async function startService(options: StartServiceOptions): Promise<AnyFastify> {
  const { serviceName, port, logger } = options;

  const trustProxyHops = options.trustProxyHops ?? 1;
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: false,
    bodyLimit: DEFAULT_BODY_LIMIT,
    // `request.ip` läses ur X-Forwarded-For, `trustProxyHops` hopp bakåt.
    // Fastify-typerna saknar number-varianten men proxy-addr stöder
    // hop-count (t.ex. trustProxy: 1) i runtime.
    // @ts-expect-error se ovan
    trustProxy: trustProxyHops === 0 ? false : trustProxyHops,
  });

  await app.register(cors, { origin: options.corsOrigins });
  await app.register(helmet);

  const redis = createRedisClient(options.redisUrl);
  await app.register(rateLimit, { max: RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW, redis });

  registerErrorHandler(app, logger);

  const rabbit = await connectRabbitMQ(options.rabbitmqUrl);
  const pingState = await startSystemPing(rabbit.channel, serviceName, (msg) => {
    logger.info({ from: msg.service }, "mottog system.ping");
  });

  registerHealthRoutes(app, [
    {
      name: "rabbitmq",
      check: async () => {
        if (!rabbit.isHealthy()) throw new Error("RabbitMQ-anslutningen är stängd");
      },
    },
    { name: "redis", check: async () => void (await redis.ping()) },
    ...(options.extraReadinessChecks ?? []),
  ]);

  // Tillfällig debug-endpoint för fas 0 — bevisar att ping-eventet gått runt
  // till alla fyra tjänsterna. Tas bort när riktiga affärsevent finns att
  // verifiera mot i stället.
  app.get("/internal/debug/pings-seen", async () => ({ seen: [...pingState.seen] }));

  await options.configure?.(app, { redis, rabbit, logger });

  app.addHook("onClose", async () => {
    pingState.stop();
    await rabbit.close();
    redis.disconnect();
  });

  await app.listen({ host: "0.0.0.0", port });
  logger.info({ port }, `${serviceName} lyssnar`);
  return app;
}

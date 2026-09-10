// auth-tjänsten. startService() (i @faktura/shared) sköter allt gemensamt
// bootstrap; configure-hooken nedan registrerar auth-modulens routes,
// M2M- och BankID-modulerna, events-exchanget och outbox-publishern.

import {
  createLogger,
  createRequireService,
  createRequireUser,
  startService,
} from "@faktura/shared";
import { registerAuthRoutes } from "./auth/routes";
import { createAuthService } from "./auth/services";
import { MockBankIdProvider } from "./bankid/provider";
import { registerBankIdRoutes } from "./bankid/routes";
import { createBankIdService } from "./bankid/services";
import { SERVICE_NAME, config } from "./config";
import { sql } from "./db";
import { registerInternalFixtures } from "./internal";
import { registerM2mRoutes } from "./m2m/routes";
import { createM2mService } from "./m2m/services";
import { EVENTS_EXCHANGE, startOutboxPublisher } from "./outbox";

const logger = createLogger(SERVICE_NAME);

const strictLimit = {
  config: { rateLimit: { max: config.strictRateLimitMax, timeWindow: "1 minute" } },
};

startService({
  serviceName: SERVICE_NAME,
  port: config.port,
  rabbitmqUrl: config.rabbitmqUrl,
  redisUrl: config.redisUrl,
  corsOrigins: config.corsOrigins,
  logger,
  extraReadinessChecks: [
    {
      name: "postgres",
      check: async () => {
        await sql`SELECT 1`;
      },
    },
  ],
  configure: async (app, ctx) => {
    await ctx.rabbit.channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });

    const requireUser = createRequireUser(config.jwtUserSecret);
    const requireService = createRequireService(config.jwtServiceSecret);

    const authService = createAuthService({ sql, redis: ctx.redis, config, logger });
    registerAuthRoutes(app, authService, {
      devEndpointsEnabled: config.devEndpointsEnabled,
      strictRateLimitMax: config.strictRateLimitMax,
    });

    const m2mService = createM2mService({ sql, config });
    registerM2mRoutes(app, m2mService, strictLimit);

    const bankIdService = createBankIdService({
      sql,
      redis: ctx.redis,
      config,
      provider: new MockBankIdProvider(ctx.redis),
    });
    registerBankIdRoutes(app, bankIdService, strictLimit);

    registerInternalFixtures(app, { requireUser, requireService });

    const publisher = startOutboxPublisher({
      sql,
      sourceService: SERVICE_NAME,
      publish: (routingKey, envelope) => {
        ctx.rabbit.channel.publish(
          EVENTS_EXCHANGE,
          routingKey,
          Buffer.from(JSON.stringify(envelope)),
          { contentType: "application/json", persistent: true },
        );
      },
      logger,
    });

    app.addHook("onClose", async () => {
      publisher.stop();
      await sql.end({ timeout: 5 });
    });
  },
}).catch((error) => {
  logger.error({ err: error }, `${SERVICE_NAME} misslyckades att starta`);
  process.exit(1);
});

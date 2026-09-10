// auth-tjänsten. startService() (i @faktura/shared) sköter allt gemensamt
// bootstrap; configure-hooken nedan registrerar auth-modulens egna routes,
// events-exchanget och outbox-publishern.

import { createLogger, startService } from "@faktura/shared";
import { registerAuthRoutes } from "./auth/routes";
import { createAuthService } from "./auth/services";
import { SERVICE_NAME, config } from "./config";
import { sql } from "./db";
import { EVENTS_EXCHANGE, startOutboxPublisher } from "./outbox";

const logger = createLogger(SERVICE_NAME);

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

    const service = createAuthService({ sql, redis: ctx.redis, config, logger });
    registerAuthRoutes(app, service, {
      devEndpointsEnabled: config.devEndpointsEnabled,
      strictRateLimitMax: config.strictRateLimitMax,
    });

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

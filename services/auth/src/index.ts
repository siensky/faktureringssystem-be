// auth-tjänsten. startService() (i @faktura/shared) sköter allt gemensamt
// bootstrap; configure-hooken nedan registrerar auth-modulens routes,
// M2M- och BankID-modulerna och outbox-publishern.

import {
  createLogger,
  createRequireService,
  createRequireUser,
  publishConfirmed,
  startDailyTimer,
  startService,
} from "@faktura/shared";
import { registerAuthRoutes } from "./auth/routes";
import { createAuthService } from "./auth/services";
import { MockBankIdProvider } from "./bankid/provider";
import { registerBankIdRoutes } from "./bankid/routes";
import { createBankIdService } from "./bankid/services";
import { SERVICE_NAME, config } from "./config";
import { sql } from "./db";
import { requireAdmin } from "./guards";
import { registerInternalFixtures } from "./internal";
import { registerM2mRoutes } from "./m2m/routes";
import { createM2mService } from "./m2m/services";
import { EVENTS_EXCHANGE, startOutboxPublisher } from "./outbox";
import { createTokenCleanupRunner } from "./token-cleanup";

const logger = createLogger(SERVICE_NAME);

const strictLimit = {
  config: { rateLimit: { max: config.strictRateLimitMax, timeWindow: "1 minute" } },
};

/** Finns tenanten och är den aktiv? Auth äger tabellen. */
async function isTenantActive(tenantId: number): Promise<boolean> {
  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM tenants WHERE id = ${tenantId} LIMIT 1
  `;
  return row?.status === "active";
}

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
    // "events"-exchanget deklareras av infra/rabbitmq/init.sh, inte här —
    // tjänsten har ingen configure-behörighet på det.

    const requireUser = createRequireUser(config.jwtUserSecret);
    const requireService = createRequireService(config.jwtServiceSecret, {
      checkTenantActive: isTenantActive,
    });

    const authService = createAuthService({ sql, redis: ctx.redis, config, logger });
    registerAuthRoutes(app, authService, {
      devEndpointsEnabled: config.devEndpointsEnabled,
      strictRateLimitMax: config.strictRateLimitMax,
      requireUser,
      requireAdmin,
    });

    const m2mService = createM2mService({ sql, config });
    registerM2mRoutes(app, m2mService, strictLimit);

    // Fas 2: alltid mock. config vägrar starta med mock i produktion —
    // RealBankIdProvider byggs i fas 11.
    const bankIdService = createBankIdService({
      sql,
      redis: ctx.redis,
      config,
      provider: new MockBankIdProvider(ctx.redis),
    });
    registerBankIdRoutes(app, bankIdService, strictLimit);

    registerInternalFixtures(app, { requireService });

    // Fas 6 (PLAN.md): "städa utgångna user_tokens" — user_tokens ägs av
    // auth (architecture.md #1), så den delen av det dagliga jobbet bor
    // här, inte i billings automation-modul. Se token-cleanup.ts.
    const tokenCleanup = createTokenCleanupRunner({ sql, redis: ctx.redis, logger });
    const tokenCleanupTimer = startDailyTimer({
      timeZone: "Europe/Stockholm",
      hour: 3,
      jobName: "auth-token-cleanup",
      logger,
      run: () => tokenCleanup.runOnce(),
    });

    const publisher = startOutboxPublisher({
      sql,
      sourceService: SERVICE_NAME,
      // Confirm-kanal: löser upp först när brokern bekräftat. Outboxen
      // markerar published_at först då.
      publish: (routingKey, envelope) =>
        publishConfirmed(
          ctx.rabbit.confirmChannel,
          EVENTS_EXCHANGE,
          routingKey,
          Buffer.from(JSON.stringify(envelope)),
          { contentType: "application/json", persistent: true },
        ),
      logger,
      onDeadLetter: (row, error) => {
        // Publishern ärver MAX_ATTEMPTS + dead-letter från @faktura/shared
        // (härdad i fas 3). Utan den här haken skulle t.ex. tenant.created
        // kunna överges permanent med bara en logg-rad. Fas 7 kopplar den
        // till en riktig larmkanal; tills dess är error-loggen larmet.
        logger.error(
          { err: error, eventId: row.eventId, eventType: row.eventType },
          "LARM: auth-event dead-letter:at efter maxantal försök",
        );
      },
    });

    app.addHook("onClose", async () => {
      tokenCleanupTimer.stop();
      publisher.stop();
      await sql.end({ timeout: 5 });
    });
  },
}).catch((error) => {
  logger.error({ err: error }, `${SERVICE_NAME} misslyckades att starta`);
  process.exit(1);
});

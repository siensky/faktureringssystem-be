// payments-tjänsten. startService() (i @faktura/shared) sköter allt
// gemensamt bootstrap; configure-hooken registrerar payments-modulernas
// routes (webhook, admin, filimport, drift), user-/service-verifiering
// och outbox-publishern.
//
// payments är bara PUBLICERARE i fas 5, ingen konsument: en lyckad
// matchning (automatisk eller manuell) publicerar payment.matched/
// payment.partial, och billings NYA konsument (services/billing/src/
// payments/*) gör den faktiska bokföringen (architecture.md #20 —
// payments skriver aldrig invoices/invoice_payments direkt).

import {
  EVENTS_EXCHANGE,
  createLogger,
  createRequireService,
  createRequireUser,
  publishConfirmed,
  startOutboxPublisher,
  startService,
} from "@faktura/shared";
import { registerAdminPaymentsRoutes } from "./admin/routes";
import { createAdminPaymentsService } from "./admin/services";
import { BillingClient } from "./billing-client";
import { SERVICE_NAME, config } from "./config";
import { sql } from "./db";
import { requireAdmin } from "./guards";
import { registerImportRoutes } from "./import/routes";
import { createImportService } from "./import/service";
import { createMatchingService } from "./matching/service";
import { registerOpsRoutes } from "./ops/routes";
import { BankTransactionRepository } from "./transactions/repository";
import { registerWebhookRoutes } from "./webhooks/routes";

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
    const requireUser = createRequireUser(config.jwtUserSecret);
    const requireService = createRequireService(config.jwtServiceSecret);
    // /admin/* kräver inloggad admin; /internal/* kräver tjänste-token + scope.
    const userChain = [requireUser, requireAdmin];

    const billingClient = new BillingClient(ctx.redis);

    const matchingService = createMatchingService({ sql, billingClient, logger });
    registerWebhookRoutes(app, {
      matchingService,
      webhookSecret: config.paymentWebhookSecret,
      logger,
    });

    const adminPaymentsService = createAdminPaymentsService(sql, billingClient, logger);
    registerAdminPaymentsRoutes(app, adminPaymentsService, sql, { userChain });

    const importService = createImportService({ matchingService, logger });
    registerImportRoutes(app, importService, { requireService });

    const bankTransactionRepo = new BankTransactionRepository(sql);
    registerOpsRoutes(app, bankTransactionRepo, { requireService });

    const publisher = startOutboxPublisher({
      sql,
      sourceService: SERVICE_NAME,
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
        // Larm: ett affärsevent gav upp efter maxantal försök. Fas 7 kopplar
        // detta till en riktig larmkanal; tills dess är error-loggen larmet.
        logger.error(
          { err: error, eventId: row.eventId, eventType: row.eventType },
          "LARM: payments-event dead-letter",
        );
      },
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

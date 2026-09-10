// billing-tjänsten. startService() (i @faktura/shared) sköter allt
// gemensamt bootstrap; configure-hooken registrerar billing-modulernas
// routes (company-settings, customers, invoices), user-/service-
// verifiering och outbox-publishern.

import {
  EVENTS_EXCHANGE,
  createLogger,
  createRequireService,
  createRequireUser,
  publishConfirmed,
  startOutboxPublisher,
  startService,
} from "@faktura/shared";
import { registerCompanySettingsRoutes } from "./company-settings/routes";
import { createCompanySettingsService } from "./company-settings/services";
import { SERVICE_NAME, config } from "./config";
import { registerCustomerRoutes } from "./customers/routes";
import { createCustomerService } from "./customers/services";
import { sql } from "./db";
import { requireAdmin } from "./guards";
import { registerInvoiceRoutes } from "./invoices/routes";
import { createInvoiceService } from "./invoices/services";

const logger = createLogger(SERVICE_NAME);

/**
 * Finns tenanten och är den aktiv? auth äger tabellen — billing läser den
 * direkt här som en övergångslösning. Fas 6 byter detta mot den lokala
 * läsmodellen company_settings.tenant_status som hålls uppdaterad av
 * tenant.suspended / tenant.reactivated (planens Domänmodell #8, #10).
 */
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
    const requireUser = createRequireUser(config.jwtUserSecret);
    const requireService = createRequireService(config.jwtServiceSecret, {
      checkTenantActive: isTenantActive,
    });
    // /admin/* kräver inloggad admin; /internal/* kräver tjänste-token + scope.
    const userChain = [requireUser, requireAdmin];

    const companySettingsService = createCompanySettingsService(sql);
    registerCompanySettingsRoutes(app, companySettingsService, { userChain, requireService });

    const customerService = createCustomerService({
      sql,
      pnrEncryptionKey: config.pnrEncryptionKey,
      pnrHmacKey: config.pnrHmacKey,
    });
    registerCustomerRoutes(app, customerService, sql, { userChain, requireService });

    const invoiceService = createInvoiceService(sql);
    registerInvoiceRoutes(app, invoiceService, sql, { userChain, requireService });

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
          "LARM: billing-event dead-letter:at",
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

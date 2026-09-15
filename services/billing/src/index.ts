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
  startDailyTimer,
  startOutboxPublisher,
  startService,
} from "@faktura/shared";
import { registerAlertsRoutes } from "./alerts/routes";
import { createAlertsService } from "./alerts/service";
import { registerAutomationRoutes } from "./automation/routes";
import { createAutomationRunner } from "./automation/runner";
import { createAutomationService } from "./automation/service";
import { registerCompanySettingsRoutes } from "./company-settings/routes";
import { createCompanySettingsService } from "./company-settings/services";
import { SERVICE_NAME, config } from "./config";
import { registerCustomerRoutes } from "./customers/routes";
import { createCustomerService } from "./customers/services";
import { sql } from "./db";
import { startDeliveryConsumer } from "./deliveries/consumer";
import { createDeliveryService } from "./deliveries/service";
import { requireAdmin } from "./guards";
import { registerInvoiceRoutes } from "./invoices/routes";
import { createInvoiceService } from "./invoices/services";
import { startPaymentConsumer } from "./payments/consumer";
import { createPaymentApplyService } from "./payments/service";

const logger = createLogger(SERVICE_NAME);

/**
 * Finns tenanten och är den aktiv? auth äger tabellen (architecture.md #2)
 * — billing läser den direkt här som en ÖVERGÅNGSLÖSNING med känt slutdatum:
 * fas 7 sätter separata Postgres-roller med GRANT bara på egna tabeller —
 * då SLUTAR den här queryn fungera och måste vara borta.
 *
 * Fas 6 övervägde en lokal läsmodell (company_settings.tenant_status,
 * redan en kolumn sedan fas 3) hållen uppdaterad av tenant.suspended /
 * tenant.reactivated — men INGEN sådan händelse publiceras någonstans i
 * systemet ännu (ingen avstängningsendpoint finns), så en konsument för
 * den skulle bara vara död kod som råkar se rätt ut i ett test som sätter
 * kolumnen direkt via SQL. automation/service.ts (fas 6) läser därför
 * samma sanning direkt här, av samma skäl — se
 * company-settings/repository.ts:s listActiveTenantIds.
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
    // Tenant-statuskollen sitter bara på requireService, inte requireUser:
    // en avstängd tenants admin kan alltså fortsätta arbeta tills
    // access-token går ut (15 min). Medvetet val — revideras i fas 6 när
    // tenant.suspended konsumeras och kan invalidera sessioner aktivt.
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

    // Fas 6: dagligt automatiseringsjobb (overdue, påminnelser, återkommande
    // fakturor, städning) kl. 03:00 Europe/Stockholm, plus en skyddad
    // endpoint för manuell körning. Redis-låset i runner.ts delas av båda
    // vägarna in.
    const automationService = createAutomationService(sql, invoiceService, logger);
    const automationRunner = createAutomationRunner({
      redis: ctx.redis,
      automation: automationService,
      logger,
    });
    registerAutomationRoutes(app, automationRunner, { requireService });
    const automationTimer = startDailyTimer({
      timeZone: "Europe/Stockholm",
      hour: 3,
      jobName: "billing-automation",
      logger,
      run: async () => {
        await automationRunner.runOnce();
      },
    });

    // Fas 7: GET /internal/ops/alerts — dead-letter-kö, publiceringsnivåns
    // dead-letter (event_outbox) och payments obetalbara transaktioner utan
    // tenant, allt i ett svar. Se alerts/service.ts.
    const alertsService = createAlertsService({
      sql,
      rabbitConnection: ctx.rabbit.connection,
      redis: ctx.redis,
    });
    registerAlertsRoutes(app, alertsService, { requireService });

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

    // Konsumerar invoice.delivery_updated från documents och skriver
    // invoices.delivery_status monotont (domain.md #29). Fall A i
    // architecture.md #7 — markering + skrivning i samma DB-transaktion.
    const deliveryConsumer = await startDeliveryConsumer({
      rabbit: ctx.rabbit,
      service: createDeliveryService(sql),
      logger,
    });

    // Konsumerar payment.matched/payment.partial från payments och skriver
    // invoice_payments/invoices (architecture.md #20 — payments skriver
    // aldrig hit direkt). Egen kö, egen konsument — se
    // services/billing/src/payments/consumer.ts för varför den inte delar
    // billing.events med deliveryConsumer.
    const paymentConsumer = await startPaymentConsumer({
      rabbit: ctx.rabbit,
      service: createPaymentApplyService(sql, logger),
      logger,
    });

    app.addHook("onClose", async () => {
      automationTimer.stop();
      publisher.stop();
      await deliveryConsumer.stop();
      await paymentConsumer.stop();
      await sql.end({ timeout: 5 });
    });
  },
}).catch((error) => {
  logger.error({ err: error }, `${SERVICE_NAME} misslyckades att starta`);
  process.exit(1);
});

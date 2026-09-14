// Fas 6 — dagligt jobb: markera overdue, skapa påminnelser (+ supersede
// originalet), generera återkommande fakturor, städa utgångna
// idempotency_keys och publicerade outbox-rader. Iterering per tenant,
// bara aktiva tenants (planens Domänmodell #8, #10).
//
// EN transaktion per påminnelse/mall, inte en stor transaktion för hela
// körningen — håller radlåsen korta (samma princip som send/credit) och
// gör att ett fel på EN faktura/mall inte river resten av tenantens eller
// körningens arbete. Fel loggas och räknas i sammanfattningen i stället
// för att stoppa loopen (svälj aldrig ett fel tyst, code-style.md #15 —
// men en batch-körning ska inte heller låta en trasig rad blockera alla
// andra tenanters legitima arbete den natten).

import { randomUUID } from "node:crypto";
import type { Logger, RequestContext } from "@faktura/shared";
import type { Sql } from "postgres";
import { writeAuditLog } from "../audit";
import { listActiveTenantIds } from "../company-settings/repository";
import { SERVICE_NAME } from "../config";
import { todayInStockholm } from "../domain/dates";
import type { InvoiceService } from "../invoices/services";
import { cleanupExpiredIdempotencyKeys, cleanupPublishedOutbox } from "./repository";
import type { AutomationRunSummary, TenantRunSummary } from "./types";

const CRON_ACTOR_SERVICE = "billing-cron";
// Tak på antal fakturor EN mall får generera i EN körning (fynd 4,
// kodgranskning PR #6). Utan det skulle en mall som blivit liggande långt
// efter (t.ex. en tenant avstängd i flera månader) bara hämta ikapp EN
// period per natt — kunden hade fått en väldigt sen faktura i taget i
// stället för att hela eftersläpet fakturerades i samma körning. 36 är
// gott om marginal (3 års månadsvis eftersläpning) och bara en säkerhets-
// spärr mot en pathologisk oändlig loop, inte en förväntad gräns.
const MAX_CATCHUP_PER_TEMPLATE = 36;

function systemCtx(tenantId: number): RequestContext {
  // Samma syntetiska S2S-kontext som invoices/controllers.ts (userId: 0,
  // role: 'admin') — men se invoices/services.ts:s CRON_ACTOR_SERVICE-
  // kommentar: userId: 0 pekar inte på en riktig users-rad och får ALDRIG
  // skrivas till audit_log.actor_user_id (FK mot users). Revisionsposterna
  // för cronen sätter därför actorUserId: null explicit, inte ctx.userId.
  return { userId: 0, tenantId, role: "admin", correlationId: randomUUID() };
}

async function runForTenant(
  sql: Sql,
  invoiceService: InvoiceService,
  logger: Logger,
  tenantId: number,
  today: string,
): Promise<TenantRunSummary> {
  const ctx = systemCtx(tenantId);
  const summary: TenantRunSummary = {
    tenantId,
    overdueMarked: 0,
    remindersCreated: 0,
    recurringGenerated: 0,
    errors: 0,
  };

  try {
    summary.overdueMarked = await invoiceService.markOverdue(ctx, today);
  } catch (error) {
    summary.errors++;
    logger.error({ err: error, tenantId }, "automation: kunde inte markera overdue");
  }

  try {
    const candidates = await invoiceService.listReminderCandidates(ctx, today);
    for (const candidate of candidates) {
      try {
        const result = await sql.begin((tx) =>
          invoiceService.createReminderInTx(ctx, tx, candidate.id, today),
        );
        if (result.created) summary.remindersCreated++;
      } catch (error) {
        summary.errors++;
        logger.error(
          { err: error, tenantId, invoiceId: candidate.id },
          "automation: kunde inte skapa påminnelse",
        );
      }
    }
  } catch (error) {
    summary.errors++;
    logger.error({ err: error, tenantId }, "automation: kunde inte läsa påminnelsekandidater");
  }

  try {
    const templates = await invoiceService.listDueTemplates(ctx, today);
    for (const template of templates) {
      // Hämtar ikapp HELA eftersläpet för mallen i den här körningen, inte
      // bara en period (fynd 4, kodgranskning PR #6) — loopar tills
      // generateFromTemplateInTx själv säger att den inte längre är mogen
      // (next_generation_date > today, eller inaktiverad under tiden).
      for (let i = 0; i < MAX_CATCHUP_PER_TEMPLATE; i++) {
        try {
          const result = await sql.begin((tx) =>
            invoiceService.generateFromTemplateInTx(ctx, tx, template.id, today),
          );
          if (!result.created) break;
          summary.recurringGenerated++;
        } catch (error) {
          summary.errors++;
          logger.error(
            { err: error, tenantId, templateId: template.id },
            "automation: kunde inte generera återkommande faktura",
          );
          break; // inte samma fel om och om igen i en het loop
        }
        if (i === MAX_CATCHUP_PER_TEMPLATE - 1) {
          logger.warn(
            { tenantId, templateId: template.id },
            "automation: mall nådde catch-up-taket, resten hämtas ikapp nästa körning",
          );
        }
      }
    }
  } catch (error) {
    summary.errors++;
    logger.error({ err: error, tenantId }, "automation: kunde inte läsa mallar");
  }

  // EN sammanfattande revisionspost per tenant och körning (domain.md #7
  // nämner "cron-körning" som en egen granskningsbar handling) — inte en
  // rad per markerad-overdue-faktura, som bara vore brus. I ett eget
  // try/catch: en trasig revisionsskrivning (fynd 1, kodgranskning PR #6)
  // ska INTE kunna se ut som ett kraschat helt jobb — den är observabilitet
  // ovanpå redan utfört arbete, inte en förutsättning för det.
  try {
    await writeAuditLog(sql, {
      tenantId,
      actorUserId: null,
      actorService: CRON_ACTOR_SERVICE,
      action: "automation.cron_run",
      resourceType: "tenant",
      resourceId: String(tenantId),
      correlationId: ctx.correlationId,
      metadata: {
        today,
        overdueMarked: summary.overdueMarked,
        remindersCreated: summary.remindersCreated,
        recurringGenerated: summary.recurringGenerated,
        errors: summary.errors,
      },
    });
  } catch (error) {
    summary.errors++;
    logger.error(
      { err: error, tenantId },
      "automation: kunde inte skriva revisionspost för körningen",
    );
  }

  return summary;
}

export function createAutomationService(sql: Sql, invoiceService: InvoiceService, logger: Logger) {
  return {
    async runDaily(now: Date = new Date()): Promise<AutomationRunSummary> {
      const today = todayInStockholm(now);
      const tenantIds = await listActiveTenantIds(sql);

      const summary: AutomationRunSummary = {
        today,
        tenantsProcessed: 0,
        overdueMarked: 0,
        remindersCreated: 0,
        recurringGenerated: 0,
        idempotencyKeysDeleted: 0,
        outboxRowsDeleted: 0,
        tenantErrors: 0,
      };

      for (const tenantId of tenantIds) {
        // Andra skyddsskiktet (fynd 1, kodgranskning PR #6): runForTenant
        // fångar redan sina egna delsteg, men ETT oväntat fel här ska ändå
        // aldrig få hoppa över RESTEN av tenants den natten — en trasig
        // tenant är inte skäl att låta alla andra stå oautomatiserade.
        try {
          const tenantSummary = await runForTenant(sql, invoiceService, logger, tenantId, today);
          summary.tenantsProcessed++;
          summary.overdueMarked += tenantSummary.overdueMarked;
          summary.remindersCreated += tenantSummary.remindersCreated;
          summary.recurringGenerated += tenantSummary.recurringGenerated;
          summary.tenantErrors += tenantSummary.errors;
        } catch (error) {
          summary.tenantErrors++;
          logger.error({ err: error, tenantId }, "automation: hela tenant-körningen misslyckades");
        }
      }

      // Global städning, oberoende av tenant-loopen — idempotency_keys och
      // event_outbox är gemensamma tabeller (architecture.md).
      try {
        summary.idempotencyKeysDeleted = await cleanupExpiredIdempotencyKeys(sql);
      } catch (error) {
        logger.error({ err: error }, "automation: kunde inte städa idempotency_keys");
      }
      try {
        summary.outboxRowsDeleted = await cleanupPublishedOutbox(sql, SERVICE_NAME);
      } catch (error) {
        logger.error({ err: error }, "automation: kunde inte städa event_outbox");
      }

      logger.info({ summary }, "automation: daglig körning klar");
      return summary;
    },
  };
}

export type AutomationService = ReturnType<typeof createAutomationService>;

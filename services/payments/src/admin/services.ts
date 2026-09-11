// Affärslogik för den manuella matchningskön (fas 5-planen, avsnitt 4).
//
// architecture.md #20: payments skriver ALDRIG till invoices/
// invoice_payments, inte ens från en admin-handling. En lyckad manuell
// matchning publicerar payment.matched/payment.partial precis som den
// automatiska vägen (matching/service.ts) — det finns bara EN skrivväg
// till invoice_payments, oavsett hur betalningen upptäcktes.

import type { PaymentMatchedPayload, PaymentPartialPayload } from "@faktura/contracts";
import {
  Conflict,
  NotFound,
  type RequestContext,
  UnprocessableEntity,
  writeEvent,
} from "@faktura/shared";
import type { Sql, TransactionSql } from "postgres";
import { writeAuditLog } from "../audit";
import type { InvoiceForMatching } from "../matching/types";
import { toUnmatchedDto } from "./mappers";
import { AdminPaymentsRepository } from "./repository";

const SERVICE_NAME = "payments";
const RESOLVABLE_INVOICE_STATUSES = new Set(["sent", "overdue"]);

/**
 * Smalast möjliga yta mot billing som den manuella matchningen behöver —
 * bara id->faktura, till skillnad från matchningsmotorns bankgiro/OCR-
 * uppslag (matching/types.ts:s MatchingBillingClient). Den konkreta
 * BillingClient-klassen uppfyller båda gränssnitten.
 */
export interface AdminBillingClient {
  resolveInvoiceById(
    tenantId: number,
    invoiceId: number,
    correlationId: string,
  ): Promise<InvoiceForMatching | undefined>;
}

export function createAdminPaymentsService(sql: Sql, billingClient: AdminBillingClient) {
  const repo = (ctx: RequestContext) => new AdminPaymentsRepository(sql, ctx);

  return {
    async listUnmatched(ctx: RequestContext) {
      const rows = await repo(ctx).listUnmatched();
      return rows.map(toUnmatchedDto);
    },

    /**
     * Anropas inifrån withIdempotency, i den transaktion den ger. Kastar
     * NotFound/Conflict/UnprocessableEntity — withIdempotency lagrar inte
     * ett svar för ett kastat fel (transaktionen rullas tillbaka och
     * anspråket städas bort), så ett senare försök med samma nyckel körs
     * om rent i stället för att spela upp ett permanent fel.
     */
    async matchInTx(ctx: RequestContext, tx: TransactionSql, id: number, invoiceId: number) {
      const r = repo(ctx);
      const row = await r.lockForDecision(tx, id);
      if (!row) throw new NotFound("Transaktionen finns inte");
      if (row.status !== "manual_review") {
        throw new Conflict("Transaktionen är redan avgjord");
      }

      // LEVANDE remainingOre (domain.md #27) — aldrig ett klientskickat
      // belopp. billing 404:ar om invoiceId inte tillhör tenanten
      // (404 över tenant-gränsen, aldrig 403 — CLAUDE.md snabbfakta).
      const resolved = await billingClient.resolveInvoiceById(
        ctx.tenantId,
        invoiceId,
        ctx.correlationId,
      );
      if (!resolved) throw new NotFound("Fakturan finns inte");
      if (!RESOLVABLE_INVOICE_STATUSES.has(resolved.status)) {
        throw new UnprocessableEntity(
          "Fakturan kan inte ta emot en betalning i sitt nuvarande läge",
        );
      }

      const amountOre = Number(row.amount_ore);
      if (amountOre > resolved.remainingOre) {
        throw new UnprocessableEntity("Beloppet överstiger fakturans kvarstående belopp");
      }

      const changed = await r.markMatched(tx, id, resolved.currentInvoiceId);
      if (changed === 0) {
        // FOR UPDATE ovan gör det här osannolikt, men koden litar aldrig
        // blint på ett enda villkor för en pengaskrivning.
        throw new Conflict("Transaktionen är redan avgjord");
      }

      const eventType = amountOre === resolved.remainingOre ? "payment.matched" : "payment.partial";
      const payload: PaymentMatchedPayload | PaymentPartialPayload = {
        invoiceId: resolved.currentInvoiceId,
        amountOre,
        // Manuell matchning har inget (source, externalId)-par att bygga
        // paymentId ur — bank_transactions.id är unikt och spårbart
        // tillbaka till raden, samma roll som "<source>:<externalId>"
        // fyller i den automatiska vägen.
        paymentId: `manual:${id}`,
        bookedAt: row.booked_at.toISOString(),
      };
      await writeEvent(tx, {
        sourceService: SERVICE_NAME,
        eventType,
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        payload: { ...payload },
      });

      await writeAuditLog(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: "payment.matched_manually",
        resourceType: "bank_transaction",
        resourceId: String(id),
        correlationId: ctx.correlationId,
        metadata: { invoiceId: resolved.currentInvoiceId, amountOre },
      });

      return {
        status: 200,
        body: { status: "matched" as const, id, invoiceId: resolved.currentInvoiceId },
      };
    },

    async ignoreInTx(ctx: RequestContext, tx: TransactionSql, id: number, reason: string) {
      const r = repo(ctx);
      const row = await r.lockForDecision(tx, id);
      if (!row) throw new NotFound("Transaktionen finns inte");
      if (row.status !== "manual_review") {
        throw new Conflict("Transaktionen är redan avgjord");
      }

      const changed = await r.markIgnored(tx, id, reason);
      if (changed === 0) throw new Conflict("Transaktionen är redan avgjord");

      await writeAuditLog(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: "payment.ignored",
        resourceType: "bank_transaction",
        resourceId: String(id),
        correlationId: ctx.correlationId,
        metadata: { reason },
      });

      return { status: 200, body: { status: "ignored" as const, id } };
    },
  };
}

export type AdminPaymentsService = ReturnType<typeof createAdminPaymentsService>;

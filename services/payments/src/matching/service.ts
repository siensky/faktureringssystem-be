// Matchningsmotorn — delad ren beslutslogik för webhook- och
// filimportvägen (fas 5-planen, avsnitt 3). Enhetstestbar utan DB genom
// en injicerad MatchingBillingClient.
//
// architecture.md #20: payments skriver ALDRIG till invoices/
// invoice_payments. En lyckad matchning publicerar payment.matched/
// payment.partial via den EGNA outboxen, i SAMMA transaktion som
// bank_transactions-raden skrivs — billings nya konsument
// (services/billing/src/payments/*) gör den faktiska bokföringen.
//
// Känd, accepterad kapplöpning: två samtidiga transaktioner mot samma
// faktura kan båda läsa en inaktuell remainingOre och båda räkna ut
// 'partial', tillsammans över totalen. Det är INTE en pengakorrekthets-
// bugg — billings konsument räknar alltid om paid_ore via SUM under
// FOR UPDATE och avgör status='paid' från det, aldrig från eventets
// eget namn (se services/billing/src/payments/service.ts).

import type { PaymentMatchedPayload, PaymentPartialPayload } from "@faktura/contracts";
import { type Logger, isValidOcr, writeEvent } from "@faktura/shared";
import type { Sql } from "postgres";
import { BankTransactionRepository } from "../transactions/repository";
import type { BankTransactionStatus, UnmatchedReason } from "../transactions/types";
import type { MatchInput, MatchOutcome, MatchingBillingClient } from "./types";

const SERVICE_NAME = "payments";

export interface MatchDecision {
  tenantId: number | null;
  status: BankTransactionStatus;
  unmatchedReason: UnmatchedReason | null;
  matchedInvoiceId: number | null;
  eventType?: "payment.matched" | "payment.partial";
}

/**
 * Ren beslutslogik, exporterad separat från match() så den kan
 * enhetstestas utan Postgres — bara en injicerad MatchingBillingClient.
 * match() (nedan) lägger DB-skrivningen och eventpubliceringen runt det
 * här beslutet; det behöver en riktig transaktion och täcks av e2e-sviten
 * i stället (rules/testing.md #12: mocka aldrig den egna databasen).
 */
export async function decideMatch(
  billingClient: MatchingBillingClient,
  input: MatchInput,
): Promise<MatchDecision> {
  const tenantId = await billingClient.resolveTenantByBankgiro(input.bankgiro, input.correlationId);
  if (tenantId === undefined) {
    return {
      tenantId: null,
      status: "unmatched",
      unmatchedReason: "unknown_bankgiro",
      matchedInvoiceId: null,
    };
  }

  if (!isValidOcr(input.ocr)) {
    return {
      tenantId,
      status: "manual_review",
      unmatchedReason: "unknown_ocr",
      matchedInvoiceId: null,
    };
  }

  const invoice = await billingClient.resolveInvoiceByOcr(tenantId, input.ocr, input.correlationId);
  if (!invoice) {
    return {
      tenantId,
      status: "manual_review",
      unmatchedReason: "unknown_ocr",
      matchedInvoiceId: null,
    };
  }
  if (invoice.status !== "sent" && invoice.status !== "overdue") {
    return {
      tenantId,
      status: "manual_review",
      unmatchedReason: "ambiguous",
      matchedInvoiceId: null,
    };
  }
  if (input.amountOre > invoice.remainingOre) {
    return {
      tenantId,
      status: "manual_review",
      unmatchedReason: "overpayment",
      matchedInvoiceId: null,
    };
  }

  const eventType =
    input.amountOre === invoice.remainingOre ? "payment.matched" : "payment.partial";
  return {
    tenantId,
    status: "matched",
    unmatchedReason: null,
    matchedInvoiceId: invoice.currentInvoiceId,
    eventType,
  };
}

export function createMatchingService(opts: {
  sql: Sql;
  billingClient: MatchingBillingClient;
  logger: Logger;
}) {
  const { sql, billingClient, logger } = opts;
  const repo = new BankTransactionRepository(sql);

  return {
    async match(input: MatchInput): Promise<MatchOutcome> {
      // Steg 1: billigt förhandstest INNAN några S2S-anrop görs.
      if (await repo.existsDuplicate(input.source, input.externalId)) {
        return { kind: "duplicate" };
      }

      // Steg 2-4: bestäm beslutet UTANFÖR transaktionen (S2S-anrop hör
      // inte hemma i en öppen DB-transaktion).
      const decision = await decideMatch(billingClient, input);

      // Steg 5: INSERT + ev. eventpublicering, EN transaktion — annars
      // kan ett event publiceras för en rad som sen rullas tillbaka,
      // eller tvärtom.
      return sql.begin(async (tx) => {
        const id = await repo.insertIfNew(tx, {
          tenantId: decision.tenantId,
          source: input.source,
          externalId: input.externalId,
          bankgiro: input.bankgiro,
          ocr: input.ocr,
          payerName: input.payerName,
          amountOre: input.amountOre,
          bookedAt: input.bookedAt,
          status: decision.status,
          unmatchedReason: decision.unmatchedReason,
          matchedInvoiceId: decision.matchedInvoiceId,
        });
        if (id === undefined) {
          // Race mot steg 1: två samtidiga leveranser av samma rad kom
          // ikapp varandra. Tomt, precis som en vanlig dubblett.
          return { kind: "duplicate" };
        }

        if (decision.status === "matched" && decision.eventType && decision.matchedInvoiceId) {
          // Byggs som ett fräscht objektliteral direkt i anropet (inte en
          // variabel typad som PaymentMatchedPayload): writeEvents
          // payload: JsonObject saknar ett explicit index-signatur-möte
          // med det genererade kontraktsgränssnittet, men ett literal med
          // exakt dessa nycklar/värdetyper matchar JsonObject fint —
          // samma mönster som övriga writeEvent-anrop i kodbasen (t.ex.
          // invoices/services.ts).
          const payload: PaymentMatchedPayload | PaymentPartialPayload = {
            invoiceId: decision.matchedInvoiceId,
            amountOre: input.amountOre,
            paymentId: `${input.source}:${input.externalId}`,
            bookedAt: input.bookedAt.toISOString(),
          };
          await writeEvent(tx, {
            sourceService: SERVICE_NAME,
            eventType: decision.eventType,
            // decision.status === 'matched' garanterar tenantId !== null
            // (bank_transactions_status_shape kräver samma sak i DB).
            tenantId: decision.tenantId as number,
            correlationId: input.correlationId,
            payload: { ...payload },
          });
        }

        if (decision.status === "unmatched") {
          logger.error(
            { bankgiro: input.bankgiro, source: input.source, externalId: input.externalId },
            "LARM: betalning mot okänt bankgiro",
          );
        }

        return {
          kind: "written",
          id,
          status: decision.status,
          tenantId: decision.tenantId,
          unmatchedReason: decision.unmatchedReason,
          matchedInvoiceId: decision.matchedInvoiceId,
        };
      });
    },
  };
}

export type MatchingService = ReturnType<typeof createMatchingService>;

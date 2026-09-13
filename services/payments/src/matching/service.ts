// Matchningsmotorn — delad ren beslutslogik för webhook- och
// filimportvägen (fas 5-planen, avsnitt 3). Enhetstestbar utan DB genom
// en injicerad MatchingBillingClient.
//
// architecture.md #20: payments skriver ALDRIG till invoices/
// invoice_payments. En lyckad matchning publicerar payment.matched/
// payment.partial via den EGNA outboxen — billings nya konsument
// (services/billing/src/payments/*) gör den faktiska bokföringen.
//
// Skrivningen sker i TVÅ steg (PR-granskning fas 5, punkt 2; domain.md
// #14): match() skriver ALLTID raden i status 'pending' FÖRST, INNAN
// billing ens rings — se transactions/repository.ts:s moduldoc. Först
// EFTER det görs S2S-anropet (decideMatch) och raden löses till sitt
// slutgiltiga läge. Kraschar/felar S2S-anropet (billing nere, fel scope,
// nätverk) har raden redan committats som 'pending' — pengarna är
// spårade, inte förlorade, och en omleverans av samma händelse löser den
// i stället för att skapa en dubblett.
//
// Känd, accepterad kapplöpning: två samtidiga transaktioner mot samma
// faktura kan båda läsa en inaktuell remainingOre och båda räkna ut
// 'partial', tillsammans över totalen. Det är INTE en pengakorrekthets-
// bugg — billings konsument räknar alltid om paid_ore via SUM under
// FOR UPDATE och avgör status='paid' från det, aldrig från eventets
// eget namn, och larmar om summan visar sig överstiga totalen trots att
// inget enskilt event påstod en överbetalning (se
// services/billing/src/payments/service.ts).

import type { PaymentMatchedPayload, PaymentPartialPayload } from "@faktura/contracts";
import { type Logger, isValidOcr, normalizeBankgiro, writeEvent } from "@faktura/shared";
import type { Sql } from "postgres";
import { BankTransactionRepository } from "../transactions/repository";
import type { BankTransactionDecision } from "../transactions/types";
import type { MatchInput, MatchOutcome, MatchingBillingClient } from "./types";

const SERVICE_NAME = "payments";

export interface MatchDecision extends BankTransactionDecision {
  eventType?: "payment.matched" | "payment.partial";
}

/**
 * Ren beslutslogik, exporterad separat från match() så den kan
 * enhetstestas utan Postgres — bara en injicerad MatchingBillingClient.
 * match() (nedan) lägger DB-skrivningen och eventpubliceringen runt det
 * här beslutet; det behöver en riktig transaktion och täcks av e2e-sviten
 * i stället (rules/testing.md #12: mocka aldrig den egna databasen).
 *
 * `bankgiro` FÖRUTSÄTTS redan normaliserad (rena siffror) av anroparen
 * — se match() nedan och normalizeBankgiro i @faktura/shared.
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

  // Tomt/saknat OCR (t.ex. en betalning utan referens) är per
  // konstruktion ett ogiltigt Luhn-format — isValidOcr("") är false —
  // så det landar redan här i manual_review/unknown_ocr i stället för
  // att avvisas vid dörren (PR-granskning fas 5, punkt 7).
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
    async match(rawInput: MatchInput): Promise<MatchOutcome> {
      // Normaliseras EN gång, här, innan bankgirot används för något —
      // varken lagring eller S2S-uppslaget mot billing ska någonsin se
      // ett format som skiljer sig från det company_settings.bankgiro
      // normaliseras till vid skrivning (PR-granskning fas 5, punkt 1).
      const input: MatchInput = { ...rawInput, bankgiro: normalizeBankgiro(rawInput.bankgiro) };

      // Steg 1: skriv raden i 'pending' FÖRE något S2S-anrop görs — se
      // moduldocen ovan och transactions/repository.ts.
      const intake = await repo.intake({
        source: input.source,
        externalId: input.externalId,
        bankgiro: input.bankgiro,
        ocr: input.ocr,
        payerName: input.payerName,
        amountOre: input.amountOre,
        bookedAt: input.bookedAt,
      });
      if (intake.status !== "pending") {
        // En redan AVGJORD rad för samma (source, external_id) — en
        // riktig dubblettleverans, inget nytt att göra.
        return { kind: "duplicate" };
      }

      // Steg 2-4: bestäm beslutet. Kastar det här (billing nere, fel
      // scope, nätverk) har raden redan committats som 'pending' ovan —
      // felet propagerar till anroparen (webhooken svarar 5xx, importen
      // noterar raden som olöst), men INGET är förlorat.
      const decision = await decideMatch(billingClient, input);

      // Steg 5: lös raden + ev. eventpublicering, EN transaktion —
      // annars kan ett event publiceras för en rad som sen rullas
      // tillbaka, eller tvärtom.
      return sql.begin(async (tx) => {
        const resolved = await repo.resolvePending(tx, intake.id, decision);
        if (!resolved) {
          // Extremt smalt race: en samtidig omleverans av samma
          // (source, external_id) hann lösa raden mellan intake() ovan
          // och den här UPDATE:en. Räkna det som en dubblett.
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
          id: intake.id,
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

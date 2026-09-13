// Affärslogik för inkommande payment.matched/payment.partial (från
// payments). Ingen HTTP, ingen RabbitMQ här — bara "givet den här
// betalningen, vad ska hända i databasen".
//
// architecture.md #7 fall A: sidoeffekten är en skrivning i den EGNA
// databasen, så markeringen i processed_events och själva bokföringen
// ligger i samma transaktion. Kraschar något rullas bådadera tillbaka och
// eventet får ett ärligt nytt försök.
//
// Eventtypen (matched/partial) är bara informativ — den avgör ALDRIG om
// fakturan blir betald. Det gör alltid en färsk SUM(amount_ore) under
// FOR UPDATE (se fas 5-planen, "Känd, accepterad kapplöpning": payments
// matchningsmotor kan i sällsynta fall räkna fel på en inaktuell
// remainingOre, men den felen kan aldrig plantera sig i paid_ore/status
// eftersom den här konsumenten alltid räknar om från grunden). Två
// tillstånd kan ändå slinka igenom kapplöpningen på ETT ställe — en
// faktura i fel läge (punkt 11 nedan) och en överbetald summa (punkt 3
// nedan) — ingetdera är en aritmetikbugg, men bägge larmas i stället för
// att tystas ner (PR-granskning fas 5, domain.md #14: pengar får aldrig
// försvinna spårlöst, inte ens in i en tyst korrekt bokföring).

import type { PaymentMatchedPayload, PaymentPartialPayload } from "@faktura/contracts";
import type { Logger, RequestContext } from "@faktura/shared";
import type { Sql } from "postgres";
import { PaymentApplyRepository } from "./repository";

export interface PaymentApplyUpdate {
  eventId: string;
  tenantId: number;
  correlationId: string;
  payload: PaymentMatchedPayload | PaymentPartialPayload;
}

export interface PaymentApplyOutcome {
  /** false = eventet var redan hanterat (dubblett), inget gjordes. */
  applied: boolean;
  /** false = payment_id var redan bokfört (dubblett på ett annat lager). */
  paymentInserted: boolean;
  /** true om fakturan gick från obetald till 'paid' av den här bokföringen. */
  invoiceMarkedPaid: boolean;
}

const BOOKABLE_STATUSES: ReadonlySet<string> = new Set(["sent", "overdue"]);

function ctxFor(tenantId: number, correlationId: string): RequestContext {
  // Konsumenten agerar för tenanten i envelopen — ingen inloggad användare.
  return { userId: 0, tenantId, role: "admin", correlationId };
}

export function createPaymentApplyService(sql: Sql, logger: Logger) {
  return {
    async apply(update: PaymentApplyUpdate): Promise<PaymentApplyOutcome> {
      const { eventId, tenantId, correlationId, payload } = update;

      return sql.begin(async (tx) => {
        const repo = new PaymentApplyRepository(tx, ctxFor(tenantId, correlationId));

        const fresh = await repo.markProcessed(eventId);
        if (!fresh) {
          return { applied: false, paymentInserted: false, invoiceMarkedPaid: false };
        }

        const invoice = await repo.lockInvoice(payload.invoiceId);
        if (!invoice) {
          // Fakturan finns inte för tenanten i eventet — payments har
          // redan verifierat detta via billings S2S-endpoints innan
          // eventet publicerades, så det här är ett inkonsistent
          // tillstånd, inte ett förväntat fall. Kastet här ligger INNE i
          // sql.begin, så HELA transaktionen — inklusive markProcessed-
          // raden ovan — rullas tillbaka (PR-granskning fas 5, punkt 10:
          // en tidigare kommentar påstod felaktigt att processed_events
          // redan var skriven och att eventet därför INTE skulle
          // konsumeras om). Eventet försöks alltså om av konsumenten,
          // precis som vilket annat transient fel som helst, upp till
          // MAX_ATTEMPTS innan det dead-lettras.
          throw new Error(
            `payment-apply: fakturan ${payload.invoiceId} finns inte för tenant ${tenantId}`,
          );
        }

        // PR-granskning fas 5, punkt 11: fakturan kan ha hunnit byta
        // status (t.ex. bli krediterad) mellan payments beslut — fattat
        // UTANFÖR den här transaktionen — och den här bokföringen.
        // Pengarna registreras ändå nedan (får aldrig tappas tyst), men
        // ett oväntat läge larmas. setPaidIfCovered rör aldrig en
        // faktura som inte är 'sent'/'overdue', så det här kan bara ge
        // en missvisande extra betalningsrad att reglera manuellt,
        // aldrig en felaktig statusändring.
        if (!BOOKABLE_STATUSES.has(invoice.status)) {
          logger.error(
            {
              invoiceId: invoice.id,
              tenantId,
              status: invoice.status,
              paymentId: payload.paymentId,
            },
            "LARM: betalning bokförd mot faktura i oväntat läge",
          );
        }

        const paymentInserted = await repo.insertPayment(
          invoice.id,
          payload.paymentId,
          payload.amountOre,
          new Date(payload.bookedAt),
        );

        const paidOre = await repo.paidOre(invoice.id);
        const totalInclVatOre = Number(invoice.total_incl_vat_ore);
        if (paidOre > totalInclVatOre) {
          // PR-granskning fas 5, punkt 3: en kapplöpning mellan
          // samtidiga delbetalningar (payments matchningsmotor beslutar
          // utifrån en LÄST, inte låst, remainingOre) kan i sällsynta
          // fall summera till mer än fakturans totalbelopp. Aritmetiken
          // är fortfarande korrekt — paidOre är alltid en färsk SUM här
          // — men själva överbetalningen får inte tystas ner.
          logger.error(
            {
              invoiceId: invoice.id,
              tenantId,
              paidOre,
              totalInclVatOre,
              overpaymentOre: paidOre - totalInclVatOre,
            },
            "LARM: faktura överbetald (samtidiga delbetalningar?)",
          );
        }

        const marked = await repo.setPaidIfCovered(invoice.id, paidOre);

        return {
          applied: true,
          paymentInserted,
          invoiceMarkedPaid: marked > 0,
        };
      });
    },
  };
}

export type PaymentApplyService = ReturnType<typeof createPaymentApplyService>;

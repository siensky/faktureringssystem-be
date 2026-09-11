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
// eftersom den här konsumenten alltid räknar om från grunden).

import type { PaymentMatchedPayload, PaymentPartialPayload } from "@faktura/contracts";
import type { RequestContext } from "@faktura/shared";
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

function ctxFor(tenantId: number, correlationId: string): RequestContext {
  // Konsumenten agerar för tenanten i envelopen — ingen inloggad användare.
  return { userId: 0, tenantId, role: "admin", correlationId };
}

export function createPaymentApplyService(sql: Sql) {
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
          // tillstånd, inte ett förväntat fall. processed_events är redan
          // skriven ovan så eventet konsumeras inte om — samma
          // "ack + larm" som annat oåterkalleligt skräp i konsumenten.
          throw new Error(
            `payment-apply: fakturan ${payload.invoiceId} finns inte för tenant ${tenantId}`,
          );
        }

        const paymentInserted = await repo.insertPayment(
          invoice.id,
          payload.paymentId,
          payload.amountOre,
          new Date(payload.bookedAt),
        );

        const paidOre = await repo.paidOre(invoice.id);
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

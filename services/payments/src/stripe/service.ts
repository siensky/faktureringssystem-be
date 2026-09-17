// Affärslogik för portalbetalning via Stripe (PLAN.md fas 10).
//
// architecture.md #20: payments skriver ALDRIG till invoices/
// invoice_payments, inte ens härifrån. En bokförd Stripe-betalning
// publicerar payment.matched/payment.partial — EXAKT samma event som
// bank_transactions-vägen — och billings BEFINTLIGA konsument
// (services/billing/src/payments/*, fas 5) gör den faktiska
// bokföringen. Ingen ändring där (planens fas 10-text: "Resten av
// kedjan... är redan byggd i fas 5 och ändras inte").
//
// Eventtypen (matched/partial) är BARA informativ, som i matching/
// service.ts — billings konsument räknar alltid om paid_ore via en färsk
// SUM och larmar själv vid en oväntad faktura-status eller överbetalning.
// Den här servicen behöver alltså inte skydda mot de fallen igen.

import type { PaymentMatchedPayload, PaymentPartialPayload } from "@faktura/contracts";
import { Conflict, type Logger, NotFound, writeEvent } from "@faktura/shared";
import type { Sql } from "postgres";
import type { StripeProvider } from "./provider";
import { StripePaymentRepository } from "./repository";
import type {
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
  StripeBillingClient,
} from "./types";

const SERVICE_NAME = "payments";
const PAYABLE_STATUSES: ReadonlySet<string> = new Set(["sent", "overdue"]);

/** Ren beslutslogik, samma formel som matching/service.ts:s decideMatch
 *  och admin/services.ts:s matchInTx — exporterad separat för
 *  enhetstestet. */
export function decideEventType(
  amountOre: number,
  remainingOre: number,
): "payment.matched" | "payment.partial" {
  return amountOre >= remainingOre ? "payment.matched" : "payment.partial";
}

export interface StripeCheckoutEvent {
  id: string;
  type: string;
  data: { object: { id: string; metadata?: Record<string, string> } };
}

export function createStripeService(opts: {
  sql: Sql;
  provider: StripeProvider;
  billingClient: StripeBillingClient;
  portalBaseUrl: string;
  logger: Logger;
}) {
  const { sql, provider, billingClient, portalBaseUrl, logger } = opts;
  const repo = new StripePaymentRepository(sql);

  return {
    /**
     * Anropas S2S från billings /portal/invoices/:id/pay (services/
     * billing/src/portal/services.ts). Beloppet är ALLTID en LEVANDE
     * remainingOre hämtad här, aldrig något klienten skickat med
     * (domain.md #27) — S2S-anropet in bär bara invoiceId.
     */
    async createCheckoutSession(
      input: CreateCheckoutSessionInput,
    ): Promise<CreateCheckoutSessionResult> {
      const resolved = await billingClient.resolveInvoiceById(
        input.tenantId,
        input.invoiceId,
        input.correlationId,
      );
      if (!resolved) throw new NotFound("Fakturan finns inte");
      if (!PAYABLE_STATUSES.has(resolved.status) || resolved.remainingOre <= 0) {
        throw new Conflict(
          "Fakturan kan inte betalas i sitt nuvarande läge (redan betald, krediterad eller ett utkast)",
        );
      }

      // Kedjeföljd faktura-id (resolved.currentInvoiceId, inte
      // input.invoiceId) i både Stripe-metadatan och länkarna, av samma
      // skäl som OCR-matchningen kedjeföljer (domain.md #33): en
      // påminnelse kan ha ersatt originalet mellan att kunden öppnade
      // fakturan och att den betalar.
      const session = await provider.createCheckoutSession({
        amountOre: resolved.remainingOre,
        currency: resolved.currency,
        tenantId: input.tenantId,
        invoiceId: resolved.currentInvoiceId,
        successUrl: `${portalBaseUrl}/invoices/${resolved.currentInvoiceId}?payment=success`,
        cancelUrl: `${portalBaseUrl}/invoices/${resolved.currentInvoiceId}?payment=cancelled`,
      });

      await repo.insertPending({
        tenantId: input.tenantId,
        invoiceId: resolved.currentInvoiceId,
        stripeSessionId: session.sessionId,
        amountOre: resolved.remainingOre,
        currency: resolved.currency,
      });

      return { url: session.url };
    },

    /**
     * Anropas av POST /webhooks/stripe EFTER signaturverifiering.
     * Returnerar `handled: false` för allt som inte kräver någon åtgärd
     * (fel eventtyp, dubblett, okänd session) — kontrollern svarar ändå
     * alltid 200 till Stripe så länge signaturen var giltig, precis som
     * webhooks/controller.ts:s mockbank-webhook.
     */
    async handleCheckoutCompleted(
      event: StripeCheckoutEvent,
      correlationId: string,
    ): Promise<{ handled: boolean }> {
      if (event.type !== "checkout.session.completed") {
        return { handled: false };
      }

      const sessionId = event.data.object.id;
      const row = await repo.findBySessionId(sessionId);
      if (!row) {
        // Kan bara ske om DB-skrivningen i createCheckoutSession
        // misslyckades EFTER att Stripe redan skapat sessionen (inga
        // pengar riskerade då — sessionen kunde bara ha slutförts om
        // den redan fanns) — eller ett event för en session som inte är
        // vår. Larma i stället för att tyst hoppa över (domain.md #14).
        logger.error(
          { stripeSessionId: sessionId, stripeEventId: event.id },
          "LARM: Stripe-webhook för okänd session — ingen matchande stripe_payments-rad",
        );
        return { handled: false };
      }

      const resolved = await billingClient.resolveInvoiceById(
        row.tenant_id,
        row.invoice_id,
        correlationId,
      );
      if (!resolved) {
        logger.error(
          { invoiceId: row.invoice_id, tenantId: row.tenant_id, stripeSessionId: sessionId },
          "LARM: Stripe-betalning mot en faktura som inte längre finns för tenanten",
        );
        return { handled: false };
      }

      // amount_ore är VÅRT eget, satt när sessionen skapades — Stripe kan
      // per konstruktion bara samla in exakt det beloppet (kunden väljer
      // det inte själv i Checkout), så det finns inget skäl att lita på
      // ett belopp ur webhook-payloaden i stället.
      const amountOre = Number(row.amount_ore);
      const eventType = decideEventType(amountOre, resolved.remainingOre);

      return sql.begin(async (tx) => {
        const updated = await repo.markPaidIfPending(tx, sessionId, event.id);
        if (!updated) {
          // Redan bokförd — en omleverans av samma (eller ett senare)
          // Stripe-event för samma session. Idempotens-DoD för fas 10.
          return { handled: false };
        }

        const payload: PaymentMatchedPayload | PaymentPartialPayload = {
          invoiceId: resolved.currentInvoiceId,
          amountOre,
          paymentId: `stripe:${sessionId}`,
          bookedAt: new Date().toISOString(),
        };
        await writeEvent(tx, {
          sourceService: SERVICE_NAME,
          eventType,
          tenantId: row.tenant_id,
          correlationId,
          payload: { ...payload },
        });

        return { handled: true };
      });
    },
  };
}

export type StripeService = ReturnType<typeof createStripeService>;

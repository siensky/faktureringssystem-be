export interface StripePaymentRow {
  id: number;
  tenant_id: number;
  invoice_id: number;
  stripe_session_id: string;
  checkout_url: string;
  expires_at: Date;
  stripe_event_id: string | null;
  amount_ore: string;
  currency: string;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCheckoutSessionInput {
  tenantId: number;
  invoiceId: number;
  correlationId: string;
}

export interface CreateCheckoutSessionResult {
  url: string;
}

/** Minsta möjliga yta mot billing (samma mönster som admin/services.ts:s
 *  AdminBillingClient) — bara id->faktura, för en LEVANDE remainingOre. */
export interface StripeBillingClient {
  resolveInvoiceById(
    tenantId: number,
    invoiceId: number,
    correlationId: string,
  ): Promise<
    | {
        currentInvoiceId: number;
        status: string;
        currency: string;
        remainingOre: number;
      }
    | undefined
  >;
}

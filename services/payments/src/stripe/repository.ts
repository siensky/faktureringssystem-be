// ALL SQL för stripe_payments (database.md #22). Inte tenant-scopad via
// TenantScopedRepository: tenant_id är alltid känt och satt vid skapande
// (till skillnad från bank_transactions), men inget här läses av en
// inloggad admin — bara payments EGEN service, S2S-vägen och webhooken.

import type { Sql, TransactionSql } from "postgres";
import type { StripePaymentRow } from "./types";

export class StripePaymentRepository {
  constructor(private readonly sql: Sql) {}

  async insertPending(data: {
    tenantId: number;
    invoiceId: number;
    stripeSessionId: string;
    amountOre: number;
    currency: string;
  }): Promise<StripePaymentRow> {
    const [row] = await this.sql<StripePaymentRow[]>`
      INSERT INTO stripe_payments (tenant_id, invoice_id, stripe_session_id, amount_ore, currency)
      VALUES (${data.tenantId}, ${data.invoiceId}, ${data.stripeSessionId}, ${data.amountOre}, ${data.currency})
      RETURNING *
    `;
    if (!row) throw new Error("INSERT stripe_payments returnerade ingen rad");
    return row;
  }

  async findBySessionId(stripeSessionId: string): Promise<StripePaymentRow | undefined> {
    const [row] = await this.sql<StripePaymentRow[]>`
      SELECT * FROM stripe_payments WHERE stripe_session_id = ${stripeSessionId} LIMIT 1
    `;
    return row;
  }

  /**
   * Villkorad övergång `WHERE paid_at IS NULL` (database.md #14-idiomet,
   * samma som email_outbox 'queued' -> 'sent') — en omlevererad
   * Stripe-webhook hittar raden redan betald och gör inget. Returnerar
   * false om raden redan var betald (dubblett) eller inte finns.
   */
  async markPaidIfPending(
    tx: TransactionSql,
    stripeSessionId: string,
    stripeEventId: string,
  ): Promise<StripePaymentRow | undefined> {
    const [row] = await tx<StripePaymentRow[]>`
      UPDATE stripe_payments
      SET paid_at = now(), stripe_event_id = ${stripeEventId}, updated_at = now()
      WHERE stripe_session_id = ${stripeSessionId} AND paid_at IS NULL
      RETURNING *
    `;
    return row;
  }
}

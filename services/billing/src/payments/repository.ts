// ALL SQL för att bokföra en inkommande betalning (database.md #22).
// Tenant-filtrerad via TenantScopedRepository — saknas tenant i kontexten
// kastar gettern (fail closed, architecture.md #21).
//
// invoice_payments/invoices ägs av billing (architecture.md #20) — det
// här är den ENDA skrivvägen till dem, oavsett om betalningen upptäcktes
// automatiskt (webhook/filimport) eller manuellt (payments admin-kö).
// payments publicerar bara event, den skriver aldrig hit direkt.

import { TenantScopedRepository } from "@faktura/shared";
import type { TransactionSql } from "postgres";

export interface LockedInvoice {
  id: number;
  status: string;
  total_incl_vat_ore: string;
}

export class PaymentApplyRepository extends TenantScopedRepository {
  constructor(
    private readonly tx: TransactionSql,
    ctx: ConstructorParameters<typeof TenantScopedRepository>[0],
  ) {
    super(ctx);
  }

  /**
   * INSERT i processed_events för (event_id, 'billing'). Returnerar true om
   * raden var ny — false betyder att eventet redan hanterats (dubblett från
   * at-least-once). Fall A i architecture.md #7: markering + jobb i SAMMA
   * transaktion.
   */
  async markProcessed(eventId: string): Promise<boolean> {
    const rows = await this.tx`
      INSERT INTO processed_events (event_id, consumer)
      VALUES (${eventId}, 'billing')
      ON CONFLICT (event_id, consumer) DO NOTHING
    `;
    return rows.count === 1;
  }

  /**
   * Låser fakturaraden (database.md #24) innan paidOre räknas om —
   * annars kan två samtidiga betalningshändelser mot samma faktura båda
   * läsa en inaktuell summa och ingen av dem sätter status='paid'.
   * undefined om fakturan inte finns för tenanten (payload pekar fel,
   * eller tenanten i eventet stämmer inte — hanteras som ett fel av
   * anroparen, inte tyst).
   */
  async lockInvoice(invoiceId: number): Promise<LockedInvoice | undefined> {
    const [row] = await this.tx<LockedInvoice[]>`
      SELECT id, status, total_incl_vat_ore
      FROM invoices
      WHERE id = ${invoiceId} AND tenant_id = ${this.tenantId}
      FOR UPDATE
    `;
    return row;
  }

  /**
   * Skriver betalningsraden. ON CONFLICT DO NOTHING på
   * invoice_payments_dedup (tenant_id, payment_id) — bälte-och-hängslen
   * utöver markProcessed/processed_events (0004_billing.js:s egen
   * migrationskommentar syftar redan på det här). Returnerar om raden
   * faktiskt sattes.
   */
  async insertPayment(
    invoiceId: number,
    paymentId: string,
    amountOre: number,
    bookedAt: Date,
  ): Promise<boolean> {
    const rows = await this.tx`
      INSERT INTO invoice_payments (tenant_id, invoice_id, payment_id, amount_ore, booked_at)
      VALUES (${this.tenantId}, ${invoiceId}, ${paymentId}, ${amountOre}, ${bookedAt})
      ON CONFLICT (tenant_id, payment_id) DO NOTHING
    `;
    return rows.count === 1;
  }

  /** Samma SUM-fråga som InvoiceRepository.paidOre — se PaymentApplyService. */
  async paidOre(invoiceId: number): Promise<number> {
    const [row] = await this.tx<{ paid: string }[]>`
      SELECT COALESCE(SUM(amount_ore), 0)::bigint AS paid
      FROM invoice_payments
      WHERE invoice_id = ${invoiceId} AND tenant_id = ${this.tenantId}
    `;
    return Number(row?.paid ?? 0);
  }

  /**
   * Villkorad UPDATE (domain.md #12): sätter status='paid' bara om
   * fakturan fortfarande är i ett obetalt läge OCH den färska SUM:en
   * faktiskt täcker totalen. Eventets egen typ (matched/partial) litas
   * ALDRIG på — bara den omräknade summan avgör (fas 5-planen, "Känd,
   * accepterad kapplöpning"). Returnerar antalet ändrade rader.
   */
  async setPaidIfCovered(invoiceId: number, paidOre: number): Promise<number> {
    const rows = await this.tx`
      UPDATE invoices SET status = 'paid', updated_at = now()
      WHERE id = ${invoiceId} AND tenant_id = ${this.tenantId}
        AND status IN ('sent', 'overdue')
        AND ${paidOre} >= total_incl_vat_ore
    `;
    return rows.count;
  }
}

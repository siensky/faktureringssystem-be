// ALL SQL för kundportalen (database.md #22). Skrivskyddad — portalen
// ändrar aldrig en faktura. TenantScopedRepository ger this.tenantId;
// this.customerId (samma bas, packages/shared/src/repository) är det
// ANDRA av de två åtkomstlagren (domain.md #33) — kastar precis som
// tenantId om kontexten saknar det, hellre ett 500 än en läcka.
//
// status != 'draft' filtreras BORT överallt: ett utkast har inget
// fakturanummer, ingen OCR och ingen snapshot — kunden ska aldrig se en
// faktura som inte ens skickats än.

import { TenantScopedRepository } from "@faktura/shared";
import type { Sql } from "postgres";
import type { AccountSummaryRow, PortalInvoiceItemRow, PortalInvoiceRow } from "./types";

export class PortalRepository extends TenantScopedRepository {
  constructor(
    private readonly sql: Sql,
    ctx: ConstructorParameters<typeof TenantScopedRepository>[0],
  ) {
    super(ctx);
  }

  async list(opts: { limit: number; offset: number }): Promise<PortalInvoiceRow[]> {
    return this.sql<PortalInvoiceRow[]>`
      SELECT * FROM invoices
      WHERE tenant_id = ${this.tenantId} AND customer_id = ${this.customerId} AND status != 'draft'
      ORDER BY created_at DESC, id DESC
      LIMIT ${opts.limit} OFFSET ${opts.offset}
    `;
  }

  /** 404 (aldrig 403) om fakturan inte finns, tillhör en annan kund eller är ett utkast. */
  async findById(id: number): Promise<PortalInvoiceRow | undefined> {
    const [row] = await this.sql<PortalInvoiceRow[]>`
      SELECT * FROM invoices
      WHERE id = ${id} AND tenant_id = ${this.tenantId} AND customer_id = ${this.customerId}
        AND status != 'draft'
      LIMIT 1
    `;
    return row;
  }

  async findItems(invoiceId: number): Promise<PortalInvoiceItemRow[]> {
    return this.sql<PortalInvoiceItemRow[]>`
      SELECT position, description, quantity, unit, unit_price_ore, vat_rate,
             line_excl_vat_ore, line_vat_ore, line_incl_vat_ore
      FROM invoice_items
      WHERE invoice_id = ${invoiceId} AND tenant_id = ${this.tenantId}
      ORDER BY position, id
    `;
  }

  async paidOre(invoiceId: number): Promise<number> {
    const [row] = await this.sql<{ paid: string }[]>`
      SELECT COALESCE(SUM(amount_ore), 0)::bigint AS paid
      FROM invoice_payments
      WHERE invoice_id = ${invoiceId} AND tenant_id = ${this.tenantId}
    `;
    return Number(row?.paid ?? 0);
  }

  /** domain.md #33: status IN ('sent','overdue') — en påminnelsekedja
   *  räknas exakt en gång, originalet är 'superseded' och faller bort. */
  async accountSummary(): Promise<AccountSummaryRow> {
    const [row] = await this.sql<AccountSummaryRow[]>`
      SELECT
        COALESCE(SUM(i.total_incl_vat_ore - COALESCE(p.paid_ore, 0)), 0)::bigint AS outstanding_ore,
        COUNT(*)::int AS outstanding_count
      FROM invoices i
      LEFT JOIN (
        SELECT invoice_id, SUM(amount_ore) AS paid_ore
        FROM invoice_payments WHERE tenant_id = ${this.tenantId}
        GROUP BY invoice_id
      ) p ON p.invoice_id = i.id
      WHERE i.tenant_id = ${this.tenantId} AND i.customer_id = ${this.customerId}
        AND i.status IN ('sent', 'overdue')
    `;
    return row ?? { outstanding_ore: "0", outstanding_count: 0 };
  }
}

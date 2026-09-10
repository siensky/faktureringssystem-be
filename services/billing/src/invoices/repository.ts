// ALL SQL för fakturor och fakturarader (database.md #22). Tenant-filtrerad.
// Nummerserien tas ur company_settings under radlås — se
// CompanySettingsRepository.lockForUpdate.

import { TenantScopedRepository } from "@faktura/shared";
import type { JsonObject } from "@faktura/shared";
import type { Sql, TransactionSql } from "postgres";
import type { InvoiceItemRow, InvoiceRow, InvoiceStatus, InvoiceType } from "./types";

type Db = Sql | TransactionSql;

export interface InvoiceListRow extends InvoiceRow {
  customer_name: string;
}

export interface InsertInvoiceData {
  customerId: number;
  invoiceNumber: number;
  ocrNumber: string;
  invoiceType: InvoiceType;
  status: InvoiceStatus;
  dateIssued: string;
  dateDue: string;
  currency: string;
  totalExclVatOre: number;
  totalVatOre: number;
  totalInclVatOre: number;
  creditsInvoiceId?: number | null;
  remindsInvoiceId?: number | null;
}

export interface InsertItemData {
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unitPriceOre: number;
  vatRate: number;
  lineExclVatOre: number;
  lineVatOre: number;
  lineInclVatOre: number;
}

export class InvoiceRepository extends TenantScopedRepository {
  constructor(
    private readonly sql: Sql,
    ctx: ConstructorParameters<typeof TenantScopedRepository>[0],
  ) {
    super(ctx);
  }

  /** Minimal kundläsning för att validera customerId och ärva betalningsvillkor. */
  async findCustomer(
    id: number,
  ): Promise<{ id: number; name: string; payment_terms_days: number | null } | undefined> {
    const [row] = await this.sql<{ id: number; name: string; payment_terms_days: number | null }[]>`
      SELECT id, name, payment_terms_days FROM customers
      WHERE id = ${id} AND tenant_id = ${this.tenantId} LIMIT 1
    `;
    return row;
  }

  /** Full kundrad — behövs för snapshotens adressblock. */
  async findCustomerFull(
    id: number,
  ): Promise<import("../customers/types").CustomerRow | undefined> {
    const [row] = await this.sql<import("../customers/types").CustomerRow[]>`
      SELECT * FROM customers WHERE id = ${id} AND tenant_id = ${this.tenantId} LIMIT 1
    `;
    return row;
  }

  async insertInvoice(tx: TransactionSql, data: InsertInvoiceData): Promise<InvoiceRow> {
    const [row] = await tx<InvoiceRow[]>`
      INSERT INTO invoices (
        tenant_id, customer_id, invoice_number, ocr_number, invoice_type, status,
        date_issued, date_due, currency,
        total_excl_vat_ore, total_vat_ore, total_incl_vat_ore,
        credits_invoice_id, reminds_invoice_id
      ) VALUES (
        ${this.tenantId}, ${data.customerId}, ${data.invoiceNumber}, ${data.ocrNumber},
        ${data.invoiceType}, ${data.status},
        ${data.dateIssued}, ${data.dateDue}, ${data.currency},
        ${data.totalExclVatOre}, ${data.totalVatOre}, ${data.totalInclVatOre},
        ${data.creditsInvoiceId ?? null}, ${data.remindsInvoiceId ?? null}
      )
      RETURNING *
    `;
    if (!row) throw new Error("INSERT invoices returnerade ingen rad");
    return row;
  }

  async insertItems(tx: TransactionSql, invoiceId: number, items: InsertItemData[]): Promise<void> {
    for (const it of items) {
      await tx`
        INSERT INTO invoice_items (
          invoice_id, tenant_id, position, description, quantity, unit,
          unit_price_ore, vat_rate,
          line_excl_vat_ore, line_vat_ore, line_incl_vat_ore
        ) VALUES (
          ${invoiceId}, ${this.tenantId}, ${it.position}, ${it.description},
          ${it.quantity}, ${it.unit}, ${it.unitPriceOre}, ${it.vatRate},
          ${it.lineExclVatOre}, ${it.lineVatOre}, ${it.lineInclVatOre}
        )
      `;
    }
  }

  async list(status?: InvoiceStatus): Promise<InvoiceListRow[]> {
    if (status) {
      return this.sql<InvoiceListRow[]>`
        SELECT i.*, c.name AS customer_name
        FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${this.tenantId} AND i.status = ${status}
        ORDER BY i.invoice_number DESC
        LIMIT 500
      `;
    }
    return this.sql<InvoiceListRow[]>`
      SELECT i.*, c.name AS customer_name
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.tenant_id = ${this.tenantId}
      ORDER BY i.invoice_number DESC
      LIMIT 500
    `;
  }

  async findById(id: number, db: Db = this.sql): Promise<InvoiceListRow | undefined> {
    const [row] = await db<InvoiceListRow[]>`
      SELECT i.*, c.name AS customer_name
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.id = ${id} AND i.tenant_id = ${this.tenantId} LIMIT 1
    `;
    return row;
  }

  async lockById(tx: TransactionSql, id: number): Promise<InvoiceRow | undefined> {
    const [row] = await tx<InvoiceRow[]>`
      SELECT * FROM invoices WHERE id = ${id} AND tenant_id = ${this.tenantId} FOR UPDATE
    `;
    return row;
  }

  async findItems(db: Db, invoiceId: number): Promise<InvoiceItemRow[]> {
    return db<InvoiceItemRow[]>`
      SELECT * FROM invoice_items
      WHERE invoice_id = ${invoiceId} AND tenant_id = ${this.tenantId}
      ORDER BY position, id
    `;
  }

  async replaceItems(
    tx: TransactionSql,
    invoiceId: number,
    items: InsertItemData[],
  ): Promise<void> {
    await tx`
      DELETE FROM invoice_items WHERE invoice_id = ${invoiceId} AND tenant_id = ${this.tenantId}
    `;
    await this.insertItems(tx, invoiceId, items);
  }

  async updateDraft(
    tx: TransactionSql,
    id: number,
    fields: {
      dateIssued: string;
      dateDue: string;
      currency: string;
      totalExclVatOre: number;
      totalVatOre: number;
      totalInclVatOre: number;
    },
  ): Promise<void> {
    await tx`
      UPDATE invoices SET
        date_issued = ${fields.dateIssued},
        date_due = ${fields.dateDue},
        currency = ${fields.currency},
        total_excl_vat_ore = ${fields.totalExclVatOre},
        total_vat_ore = ${fields.totalVatOre},
        total_incl_vat_ore = ${fields.totalInclVatOre},
        updated_at = now()
      WHERE id = ${id} AND tenant_id = ${this.tenantId}
    `;
  }

  async markSent(tx: TransactionSql, id: number): Promise<void> {
    await tx`
      UPDATE invoices SET status = 'sent', sent_at = now(), updated_at = now()
      WHERE id = ${id} AND tenant_id = ${this.tenantId}
    `;
  }

  async setStatus(tx: TransactionSql, id: number, status: InvoiceStatus): Promise<void> {
    await tx`
      UPDATE invoices SET status = ${status}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${this.tenantId}
    `;
  }

  async deleteInvoice(tx: TransactionSql, id: number): Promise<void> {
    await tx`DELETE FROM invoices WHERE id = ${id} AND tenant_id = ${this.tenantId}`;
  }

  async insertSnapshot(tx: TransactionSql, invoiceId: number, payload: JsonObject): Promise<void> {
    await tx`
      INSERT INTO invoice_snapshots (invoice_id, tenant_id, payload)
      VALUES (${invoiceId}, ${this.tenantId}, ${tx.json(payload)})
    `;
  }

  async findSnapshot(invoiceId: number): Promise<JsonObject | undefined> {
    const [row] = await this.sql<{ payload: JsonObject }[]>`
      SELECT payload FROM invoice_snapshots
      WHERE invoice_id = ${invoiceId} AND tenant_id = ${this.tenantId} LIMIT 1
    `;
    return row?.payload;
  }

  async findByOcr(ocr: string): Promise<InvoiceRow | undefined> {
    const [row] = await this.sql<InvoiceRow[]>`
      SELECT * FROM invoices WHERE ocr_number = ${ocr} AND tenant_id = ${this.tenantId} LIMIT 1
    `;
    return row;
  }

  async findByIdBasic(id: number): Promise<InvoiceRow | undefined> {
    const [row] = await this.sql<InvoiceRow[]>`
      SELECT * FROM invoices WHERE id = ${id} AND tenant_id = ${this.tenantId} LIMIT 1
    `;
    return row;
  }

  async paidOre(invoiceId: number): Promise<number> {
    const [row] = await this.sql<{ paid: string }[]>`
      SELECT COALESCE(SUM(amount_ore), 0)::bigint AS paid
      FROM invoice_payments
      WHERE invoice_id = ${invoiceId} AND tenant_id = ${this.tenantId}
    `;
    return Number(row?.paid ?? 0);
  }
}

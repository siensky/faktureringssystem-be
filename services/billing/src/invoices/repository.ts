// ALL SQL för fakturor och fakturarader (database.md #22). Tenant-filtrerad.
// Nummerserien tas ur company_settings under radlås vid send/credit — se
// CompanySettingsRepository.lockForUpdate. Utkast har invoice_number NULL.

import { TenantScopedRepository } from "@faktura/shared";
import type { JsonObject } from "@faktura/shared";
import type { Sql, TransactionSql } from "postgres";
import type { CustomerRow } from "../customers/types";
import type { InvoiceItemRow, InvoiceRow, InvoiceStatus, InvoiceType } from "./types";

type Db = Sql | TransactionSql;

export interface InvoiceListRow extends InvoiceRow {
  customer_name: string;
}

export interface InsertInvoiceData {
  customerId: number;
  invoiceNumber: number | null;
  ocrNumber: string | null;
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
    db: Db = this.sql,
  ): Promise<{ id: number; name: string; payment_terms_days: number | null } | undefined> {
    const [row] = await db<{ id: number; name: string; payment_terms_days: number | null }[]>`
      SELECT id, name, payment_terms_days FROM customers
      WHERE id = ${id} AND tenant_id = ${this.tenantId} LIMIT 1
    `;
    return row;
  }

  /** Full kundrad — behövs för snapshotens adressblock. */
  async findCustomerFull(id: number, db: Db = this.sql): Promise<CustomerRow | undefined> {
    const [row] = await db<CustomerRow[]>`
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

  /** En multi-row INSERT — håller kort kritisk sektion när fakturanumret är låst. */
  async insertItems(tx: TransactionSql, invoiceId: number, items: InsertItemData[]): Promise<void> {
    if (items.length === 0) return;
    const rows = items.map((it) => ({
      invoice_id: invoiceId,
      tenant_id: this.tenantId,
      position: it.position,
      description: it.description,
      quantity: it.quantity,
      unit: it.unit,
      unit_price_ore: it.unitPriceOre,
      vat_rate: it.vatRate,
      line_excl_vat_ore: it.lineExclVatOre,
      line_vat_ore: it.lineVatOre,
      line_incl_vat_ore: it.lineInclVatOre,
    }));
    await tx`INSERT INTO invoice_items ${tx(rows)}`;
  }

  async list(opts: { status?: InvoiceStatus; limit: number; offset: number }): Promise<
    InvoiceListRow[]
  > {
    const { status, limit, offset } = opts;
    if (status) {
      return this.sql<InvoiceListRow[]>`
        SELECT i.*, c.name AS customer_name
        FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${this.tenantId} AND i.status = ${status}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }
    return this.sql<InvoiceListRow[]>`
      SELECT i.*, c.name AS customer_name
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.tenant_id = ${this.tenantId}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ${limit} OFFSET ${offset}
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

  /** draft -> sent, och tilldelar samtidigt nummer + OCR. */
  async markSent(
    tx: TransactionSql,
    id: number,
    invoiceNumber: number,
    ocrNumber: string,
  ): Promise<void> {
    await tx`
      UPDATE invoices SET
        status = 'sent', sent_at = now(), updated_at = now(),
        invoice_number = ${invoiceNumber}, ocr_number = ${ocrNumber}
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

  async findByIdBasic(id: number, db: Db = this.sql): Promise<InvoiceRow | undefined> {
    const [row] = await db<InvoiceRow[]>`
      SELECT * FROM invoices WHERE id = ${id} AND tenant_id = ${this.tenantId} LIMIT 1
    `;
    return row;
  }

  async paidOre(invoiceId: number, db: Db = this.sql): Promise<number> {
    const [row] = await db<{ paid: string }[]>`
      SELECT COALESCE(SUM(amount_ore), 0)::bigint AS paid
      FROM invoice_payments
      WHERE invoice_id = ${invoiceId} AND tenant_id = ${this.tenantId}
    `;
    return Number(row?.paid ?? 0);
  }
}

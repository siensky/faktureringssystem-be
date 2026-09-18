// ALL SQL för fakturor och fakturarader (database.md #22). Tenant-filtrerad.
// Nummerserien tas ur company_settings under radlås vid send/credit — se
// CompanySettingsRepository.lockForUpdate. Utkast har invoice_number NULL.

import { TenantScopedRepository } from "@faktura/shared";
import type { JsonObject } from "@faktura/shared";
import type { Sql, TransactionSql } from "postgres";
import type { CustomerRow } from "../customers/types";
import type { RecurrenceInterval } from "../domain/dates";
import type {
  DeliveryStatus,
  InvoiceItemRow,
  InvoiceRow,
  InvoiceStatus,
  InvoiceTemplateRow,
  InvoiceType,
} from "./types";

type Db = Sql | TransactionSql;

export interface InvoiceListRow extends InvoiceRow {
  customer_name: string;
}

export interface InvoiceTemplateListRow extends InvoiceTemplateRow {
  customer_name: string;
}

export interface InsertTemplateData {
  customerId: number;
  interval: RecurrenceInterval;
  nextGenerationDate: string;
  billingDay: number;
  // JsonObject, inte TemplateData: en namngiven interface saknar
  // indexsignatur, som postgres.js' `.json()`-helper kräver (samma knep
  // som buildSnapshotPayload/insertSnapshot ovan — typa gränsen mot .json()
  // löst, typa läsningen tillbaka (InvoiceTemplateRow.template_data) strikt).
  templateData: JsonObject;
}

export interface UpdateTemplateData {
  interval: RecurrenceInterval;
  nextGenerationDate: string;
  billingDay: number;
  templateData: JsonObject;
  isActive: boolean;
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
  parentTemplateId?: number | null;
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
        credits_invoice_id, reminds_invoice_id, parent_template_id
      ) VALUES (
        ${this.tenantId}, ${data.customerId}, ${data.invoiceNumber}, ${data.ocrNumber},
        ${data.invoiceType}, ${data.status},
        ${data.dateIssued}, ${data.dateDue}, ${data.currency},
        ${data.totalExclVatOre}, ${data.totalVatOre}, ${data.totalInclVatOre},
        ${data.creditsInvoiceId ?? null}, ${data.remindsInvoiceId ?? null}, ${data.parentTemplateId ?? null}
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

  /** Fas 8: leveransvyn — samma lista som list(), filtrerad på delivery_status i stället för status. */
  async listByDeliveryStatus(opts: {
    deliveryStatus?: DeliveryStatus;
    limit: number;
    offset: number;
  }): Promise<InvoiceListRow[]> {
    const { deliveryStatus, limit, offset } = opts;
    if (deliveryStatus) {
      return this.sql<InvoiceListRow[]>`
        SELECT i.*, c.name AS customer_name
        FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${this.tenantId} AND i.delivery_status = ${deliveryStatus}
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

  /**
   * Fas 6: sent -> overdue för fakturor vars förfallodatum passerat. Rent
   * urvalsvillkor (planens Idempotens #7) — en andra körning samma dag
   * hittar ingenting (raderna är redan 'overdue', inte längre 'sent'), så
   * det behövs ingen egen markering av att jobbet redan kört.
   */
  async markOverdueBulk(today: string, db: Db = this.sql): Promise<number> {
    const rows = await db`
      UPDATE invoices SET status = 'overdue', updated_at = now()
      WHERE tenant_id = ${this.tenantId} AND status = 'sent' AND date_due < ${today}
    `;
    return rows.count;
  }

  /**
   * Fas 6: kandidater för påminnelse. Exakt WHERE-satsen från planens
   * Idempotens #7 — NOT EXISTS gör urvalet självt idempotent (en redan
   * påmind faktura väljs aldrig igen), och radlåset som tas per kandidat i
   * services.ts är det som gör det säkert även vid en race mellan två
   * samtidiga körningar.
   */
  async findReminderCandidates(today: string, db: Db = this.sql): Promise<InvoiceRow[]> {
    return db<InvoiceRow[]>`
      SELECT i.* FROM invoices i
      WHERE i.tenant_id = ${this.tenantId}
        AND i.date_due < ${today}
        AND i.status IN ('sent', 'overdue')
        AND i.invoice_type = 'invoice'
        AND i.reminds_invoice_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM invoices r WHERE r.reminds_invoice_id = i.id)
      ORDER BY i.id
    `;
  }

  /** Originalet -> superseded, i samma transaktion som påminnelsen skapas. */
  async supersede(tx: TransactionSql, originalId: number, byInvoiceId: number): Promise<void> {
    await tx`
      UPDATE invoices SET status = 'superseded', superseded_by_invoice_id = ${byInvoiceId}, updated_at = now()
      WHERE id = ${originalId} AND tenant_id = ${this.tenantId}
    `;
  }

  // postgres.js parsar DATE (liksom TIMESTAMP/TIMESTAMPTZ) till ett JS
  // Date-objekt som standard — trots att InvoiceTemplateRow deklarerar
  // next_generation_date som string (samma redan existerande mönster som
  // InvoiceRow.date_due/date_issued). services.ts gör RIKTIG
  // strängaritmetik på det fältet (addDays/advanceByInterval, "YYYY-MM-DD"
  // .split("-")), så det måste vara en sträng härifrån — ::text tvingar
  // Postgres att skicka det som text (OID 25) i stället för date (OID
  // 1082), vilket kringgår parsningen utan att röra den delade DB-klienten
  // (som andra, redan mergade kodvägar kan förlita sig på annorlunda).
  /** Fas 6: mallar som är mogna att generera en ny faktura ur. Läsning, olåst. */
  async findDueTemplates(today: string, db: Db = this.sql): Promise<InvoiceTemplateRow[]> {
    return db<InvoiceTemplateRow[]>`
      SELECT id, tenant_id, customer_id, interval, next_generation_date::text AS next_generation_date,
             billing_day, is_active, template_data, created_at, updated_at
      FROM invoice_templates
      WHERE tenant_id = ${this.tenantId} AND is_active AND next_generation_date <= ${today}
      ORDER BY id
    `;
  }

  /** Radlås inför generering — samma "läs-modifiera-skriv med lås" som fakturanumret (database.md #24). */
  async lockTemplate(tx: TransactionSql, id: number): Promise<InvoiceTemplateRow | undefined> {
    const [row] = await tx<InvoiceTemplateRow[]>`
      SELECT id, tenant_id, customer_id, interval, next_generation_date::text AS next_generation_date,
             billing_day, is_active, template_data, created_at, updated_at
      FROM invoice_templates WHERE id = ${id} AND tenant_id = ${this.tenantId} FOR UPDATE
    `;
    return row;
  }

  async advanceTemplateDate(tx: TransactionSql, id: number, nextDate: string): Promise<void> {
    await tx`
      UPDATE invoice_templates SET next_generation_date = ${nextDate}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${this.tenantId}
    `;
  }

  // --- Fas 13: admin-CRUD på mallar (ovanstående metoder är bara den
  // redan existerande generatorns läsningar/skrivningar — ingen av dem
  // skapar/ändrar/tar bort en mall). Samma ::text-motivering som
  // findDueTemplates/lockTemplate ovan gäller genomgående här.

  async insertTemplate(tx: TransactionSql, data: InsertTemplateData): Promise<InvoiceTemplateRow> {
    const [row] = await tx<InvoiceTemplateRow[]>`
      INSERT INTO invoice_templates (
        tenant_id, customer_id, interval, next_generation_date, billing_day, template_data
      ) VALUES (
        ${this.tenantId}, ${data.customerId}, ${data.interval}, ${data.nextGenerationDate},
        ${data.billingDay}, ${tx.json(data.templateData)}
      )
      RETURNING id, tenant_id, customer_id, interval, next_generation_date::text AS next_generation_date,
                billing_day, is_active, template_data, created_at, updated_at
    `;
    if (!row) throw new Error("INSERT invoice_templates returnerade ingen rad");
    return row;
  }

  async listTemplates(db: Db = this.sql): Promise<InvoiceTemplateListRow[]> {
    return db<InvoiceTemplateListRow[]>`
      SELECT t.id, t.tenant_id, t.customer_id, t.interval,
             t.next_generation_date::text AS next_generation_date,
             t.billing_day, t.is_active, t.template_data, t.created_at, t.updated_at,
             c.name AS customer_name
      FROM invoice_templates t JOIN customers c ON c.id = t.customer_id
      WHERE t.tenant_id = ${this.tenantId}
      ORDER BY t.created_at DESC, t.id DESC
    `;
  }

  async findTemplateById(
    id: number,
    db: Db = this.sql,
  ): Promise<InvoiceTemplateListRow | undefined> {
    const [row] = await db<InvoiceTemplateListRow[]>`
      SELECT t.id, t.tenant_id, t.customer_id, t.interval,
             t.next_generation_date::text AS next_generation_date,
             t.billing_day, t.is_active, t.template_data, t.created_at, t.updated_at,
             c.name AS customer_name
      FROM invoice_templates t JOIN customers c ON c.id = t.customer_id
      WHERE t.id = ${id} AND t.tenant_id = ${this.tenantId} LIMIT 1
    `;
    return row;
  }

  async updateTemplate(tx: TransactionSql, id: number, fields: UpdateTemplateData): Promise<void> {
    await tx`
      UPDATE invoice_templates SET
        interval = ${fields.interval},
        next_generation_date = ${fields.nextGenerationDate},
        billing_day = ${fields.billingDay},
        template_data = ${tx.json(fields.templateData)},
        is_active = ${fields.isActive},
        updated_at = now()
      WHERE id = ${id} AND tenant_id = ${this.tenantId}
    `;
  }

  async deleteTemplate(tx: TransactionSql, id: number): Promise<void> {
    await tx`DELETE FROM invoice_templates WHERE id = ${id} AND tenant_id = ${this.tenantId}`;
  }
}

// Affärslogik för fakturor (code-style.md #2, #5). Ingen HTTP, inga
// statuskoder utom via BaseError-subklasser.
//
// Regler som bor här:
//   - draft är enda ändringsbara läget; PUT/DELETE mot annat -> 409 (domain.md #1)
//   - fakturanummer + OCR tilldelas vid SEND/CREDIT, inte när utkastet
//     skapas — ett utkast förbrukar inget nummer, så att radera det river
//     inget hål i serien (domain.md #6). Numret tas ur company_settings
//     under radlås i samma transaktion som det tilldelas (domain.md #7),
//     och låset tas så sent som möjligt så det hålls kort.
//   - moms per rad, avrundning en gång på radnivå, totalen = summan av
//     avrundade rader (domain.md #10)
//   - send: snapshot + status draft->sent + invoice.sent via outbox, allt
//     i en transaktion (planens Domänmodell #1)
//   - credit: ny credit_note i settled, originalet -> credited, i en
//     transaktion; kreditraderna är negerade kopior (domain.md #4)

import {
  BadRequest,
  Conflict,
  NotFound,
  type RequestContext,
  UnprocessableEntity,
  deriveOcr,
  writeEvent,
} from "@faktura/shared";
import type { Sql, TransactionSql } from "postgres";
import { writeAuditLog } from "../audit";
import { CompanySettingsRepository } from "../company-settings/repository";
import type { CompanySettingsRow } from "../company-settings/types";
import { addDays, todayInStockholm } from "../domain/dates";
import { type LineAmounts, computeLine, sumTotals } from "../domain/vat";
import { buildSnapshotPayload, toDetail, toSummary } from "./mappers";
import { type InsertItemData, InvoiceRepository } from "./repository";
import type {
  CreateInvoiceInput,
  InvoiceRow,
  InvoiceStatus,
  LineInputDto,
  UpdateInvoiceInput,
} from "./types";

const SERVICE_NAME = "billing";
const CREDITABLE: ReadonlySet<InvoiceStatus> = new Set(["sent", "overdue", "paid"]);
const PAGE_DEFAULT = 100;
const PAGE_MAX = 200;

function toItems(lines: LineInputDto[]): InsertItemData[] {
  return lines.map((line, i) => {
    const amounts = computeLine({
      quantity: line.quantity,
      unitPriceOre: line.unitPriceOre,
      vatRate: line.vatRate,
    });
    return {
      position: i + 1,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit ?? "st",
      unitPriceOre: line.unitPriceOre,
      vatRate: line.vatRate,
      ...amounts,
    };
  });
}

const amountsOf = (it: InsertItemData): LineAmounts => ({
  lineExclVatOre: it.lineExclVatOre,
  lineVatOre: it.lineVatOre,
  lineInclVatOre: it.lineInclVatOre,
});

/** Kastar om datumen är orimliga. dateIssued får inte ligga i framtiden. */
function assertDates(dateIssued: string, dateDue: string): void {
  if (dateIssued > todayInStockholm()) {
    throw new BadRequest("Fakturadatum kan inte ligga i framtiden");
  }
  if (dateDue < dateIssued) {
    throw new BadRequest("Förfallodatum kan inte vara före fakturadatum");
  }
}

export function createInvoiceService(sql: Sql) {
  const invRepo = (ctx: RequestContext) => new InvoiceRepository(sql, ctx);
  const csRepo = (ctx: RequestContext) => new CompanySettingsRepository(sql, ctx);

  async function detail(ctx: RequestContext, db: Sql | TransactionSql, id: number) {
    const repo = invRepo(ctx);
    const row = await repo.findById(id, db);
    if (!row) throw new NotFound("Fakturan finns inte");
    const items = await repo.findItems(db, id);
    const paid = row.status === "draft" ? 0 : await repo.paidOre(id, db);
    return toDetail(row, items, paid);
  }

  /**
   * Tar radlåset på nummerserien och returnerar numret, OCR:et och den
   * låsta company_settings-raden (som kreditvägen behöver för snapshoten).
   * Anropa sent i tx:en så låset hålls kort.
   */
  async function allocateNumber(
    ctx: RequestContext,
    tx: TransactionSql,
  ): Promise<{ number: number; ocr: string; settings: CompanySettingsRow }> {
    const settingsRepo = csRepo(ctx);
    const settings = await settingsRepo.lockForUpdate(tx);
    const number = settings.next_invoice_number;
    await settingsRepo.bumpInvoiceNumber(tx);
    return { number, ocr: deriveOcr(number), settings };
  }

  return {
    async createInTx(ctx: RequestContext, tx: TransactionSql, input: CreateInvoiceInput) {
      const repo = invRepo(ctx);

      const customer = await repo.findCustomer(input.customerId, tx);
      if (!customer) throw new BadRequest("Okänd kund");

      const settings = await csRepo(ctx).find();
      const items = toItems(input.lines);
      const totals = sumTotals(items.map(amountsOf));

      const dateIssued = input.dateIssued ?? todayInStockholm();
      const terms = customer.payment_terms_days ?? settings?.payment_terms_days ?? 30;
      const dateDue = input.dateDue ?? addDays(dateIssued, terms);
      assertDates(dateIssued, dateDue);

      const invoice = await repo.insertInvoice(tx, {
        customerId: customer.id,
        invoiceNumber: null, // tilldelas vid send
        ocrNumber: null,
        invoiceType: "invoice",
        status: "draft",
        dateIssued,
        dateDue,
        currency: input.currency ?? "SEK",
        totalExclVatOre: totals.totalExclVatOre,
        totalVatOre: totals.totalVatOre,
        totalInclVatOre: totals.totalInclVatOre,
      });
      await repo.insertItems(tx, invoice.id, items);

      await writeAuditLog(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: "invoice.created",
        resourceType: "invoice",
        resourceId: String(invoice.id),
        correlationId: ctx.correlationId,
        metadata: { totalInclVatOre: totals.totalInclVatOre },
      });

      return { status: 201, body: await detail(ctx, tx, invoice.id) };
    },

    async list(
      ctx: RequestContext,
      opts: { status?: InvoiceStatus; limit?: number; offset?: number },
    ) {
      const limit = Math.min(opts.limit ?? PAGE_DEFAULT, PAGE_MAX);
      const offset = opts.offset ?? 0;
      const rows = await invRepo(ctx).list({ status: opts.status, limit: limit + 1, offset });
      const hasMore = rows.length > limit;
      return { items: rows.slice(0, limit).map(toSummary), hasMore };
    },

    async get(ctx: RequestContext, id: number) {
      return detail(ctx, sql, id);
    },

    async update(ctx: RequestContext, id: number, input: UpdateInvoiceInput) {
      return sql.begin(async (tx) => {
        const repo = invRepo(ctx);
        const current = await repo.lockById(tx, id);
        if (!current) throw new NotFound("Fakturan finns inte");
        if (current.status !== "draft") {
          throw new Conflict("Endast utkast kan ändras");
        }

        const dateIssued = input.dateIssued ?? current.date_issued;
        const dateDue = input.dateDue ?? current.date_due;
        const currency = input.currency ?? current.currency;
        assertDates(dateIssued, dateDue);

        let totals = {
          totalExclVatOre: Number(current.total_excl_vat_ore),
          totalVatOre: Number(current.total_vat_ore),
          totalInclVatOre: Number(current.total_incl_vat_ore),
        };
        if (input.lines) {
          const items = toItems(input.lines);
          totals = sumTotals(items.map(amountsOf));
          await repo.replaceItems(tx, id, items);
        }

        await repo.updateDraft(tx, id, { dateIssued, dateDue, currency, ...totals });
        await writeAuditLog(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: "invoice.updated",
          resourceType: "invoice",
          resourceId: String(id),
          correlationId: ctx.correlationId,
        });
        return detail(ctx, tx, id);
      });
    },

    async remove(ctx: RequestContext, id: number) {
      return sql.begin(async (tx) => {
        const repo = invRepo(ctx);
        const current = await repo.lockById(tx, id);
        if (!current) throw new NotFound("Fakturan finns inte");
        if (current.status !== "draft") {
          throw new Conflict("Endast utkast kan raderas");
        }
        // Utkast har inget nummer -> ingen lucka i serien.
        await repo.deleteInvoice(tx, id);
        await writeAuditLog(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: "invoice.deleted",
          resourceType: "invoice",
          resourceId: String(id),
          correlationId: ctx.correlationId,
        });
        return { status: "ok" as const };
      });
    },

    async sendInTx(ctx: RequestContext, tx: TransactionSql, id: number) {
      const repo = invRepo(ctx);

      const invoice = await repo.lockById(tx, id);
      if (!invoice) throw new NotFound("Fakturan finns inte");
      if (invoice.status !== "draft") {
        throw new Conflict("Fakturan är redan skickad");
      }

      // Läs allt som inte kräver låset först.
      const customer = await repo.findCustomerFull(invoice.customer_id, tx);
      if (!customer) throw new BadRequest("Fakturans kund saknas");
      const items = await repo.findItems(tx, id);

      // Kritisk sektion: lås company_settings, kontrollera avsändaruppgifter,
      // ta numret, skriv. Hålls kort.
      const settings = await csRepo(ctx).lockForUpdate(tx);
      if (!settings.company_name || !settings.org_number || !settings.bankgiro) {
        throw new UnprocessableEntity(
          "Företagsnamn, organisationsnummer och bankgiro måste vara ifyllda innan en faktura kan skickas",
        );
      }
      const number = settings.next_invoice_number;
      const ocr = deriveOcr(number);
      await csRepo(ctx).bumpInvoiceNumber(tx);
      await repo.markSent(tx, id, number, ocr);

      const sentInvoice: InvoiceRow = {
        ...invoice,
        invoice_number: number,
        ocr_number: ocr,
        status: "sent",
      };
      const payload = buildSnapshotPayload({
        invoice: sentInvoice,
        items,
        company: settings,
        customer,
      });
      await repo.insertSnapshot(tx, id, payload);

      await writeEvent(tx, {
        sourceService: SERVICE_NAME,
        eventType: "invoice.sent",
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        payload: { invoiceId: id },
      });
      await writeAuditLog(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: "invoice.sent",
        resourceType: "invoice",
        resourceId: String(id),
        correlationId: ctx.correlationId,
        metadata: { invoiceNumber: number },
      });

      return { status: 200, body: await detail(ctx, tx, id) };
    },

    async creditInTx(ctx: RequestContext, tx: TransactionSql, id: number) {
      const repo = invRepo(ctx);

      const original = await repo.lockById(tx, id);
      if (!original) throw new NotFound("Fakturan finns inte");
      if (original.invoice_type !== "invoice") {
        throw new Conflict("Bara vanliga fakturor kan krediteras");
      }
      if (!CREDITABLE.has(original.status)) {
        throw new Conflict("Fakturan är i ett läge som inte kan krediteras");
      }

      const originalItems = await repo.findItems(tx, id);
      const creditItems: InsertItemData[] = originalItems.map((it, i) => ({
        position: i + 1,
        description: it.description,
        // Kreditraden speglar originalraden med ombytt tecken (domain.md #4).
        quantity: -Number(it.quantity),
        unit: it.unit,
        unitPriceOre: Number(it.unit_price_ore),
        vatRate: Number(it.vat_rate),
        lineExclVatOre: -Number(it.line_excl_vat_ore),
        lineVatOre: -Number(it.line_vat_ore),
        lineInclVatOre: -Number(it.line_incl_vat_ore),
      }));
      const totals = sumTotals(creditItems.map(amountsOf));

      // Kreditfakturan skickas till kunden som PDF (domain.md #35) och
      // documents renderar ur snapshoten, aldrig de levande tabellerna —
      // så kundraden behövs för adressblocket redan här.
      const customer = await repo.findCustomerFull(original.customer_id, tx);
      if (!customer) throw new BadRequest("Fakturans kund saknas");

      // Kritisk sektion: nummerserien. settings används till snapshoten nedan.
      const { number, ocr, settings } = await allocateNumber(ctx, tx);

      const today = todayInStockholm();
      const creditNote = await repo.insertInvoice(tx, {
        customerId: original.customer_id,
        invoiceNumber: number,
        ocrNumber: ocr,
        invoiceType: "credit_note",
        status: "settled",
        dateIssued: today,
        dateDue: today,
        currency: original.currency,
        totalExclVatOre: totals.totalExclVatOre,
        totalVatOre: totals.totalVatOre,
        totalInclVatOre: totals.totalInclVatOre,
        creditsInvoiceId: original.id,
      });
      await repo.insertItems(tx, creditNote.id, creditItems);
      await repo.setStatus(tx, original.id, "credited");

      // Frusen kopia för PDF-rendering (database.md #30), på samma form som
      // send-vägen skriver. Läs tillbaka de nyss insatta raderna så
      // snapshoten får exakt DB-formen (öre som öre), inte de negerade
      // InsertItemData-talen.
      const creditRows = await repo.findItems(tx, creditNote.id);
      await repo.insertSnapshot(
        tx,
        creditNote.id,
        buildSnapshotPayload({
          invoice: creditNote,
          items: creditRows,
          company: settings,
          customer,
        }),
      );

      await writeEvent(tx, {
        sourceService: SERVICE_NAME,
        eventType: "invoice.credited",
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        payload: { invoiceId: creditNote.id, creditsInvoiceId: original.id },
      });
      await writeAuditLog(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: "invoice.credited",
        resourceType: "invoice",
        resourceId: String(original.id),
        correlationId: ctx.correlationId,
        metadata: { creditNoteId: creditNote.id, creditNumber: number },
      });

      return { status: 201, body: await detail(ctx, tx, creditNote.id) };
    },

    /** S2S: snapshotens payload för documents. 404 om ingen snapshot. */
    async getSnapshot(ctx: RequestContext, id: number) {
      const snap = await invRepo(ctx).findSnapshot(id);
      if (!snap) throw new NotFound("Ingen snapshot för fakturan");
      return snap;
    },

    /**
     * S2S: OCR -> aktuell faktura, med kedjeföljning av
     * superseded_by_invoice_id (planens Domänmodell #3). payments bokför
     * betalningen på currentInvoiceId, inte på den OCR pekar på.
     */
    async resolveByOcr(ctx: RequestContext, ocr: string) {
      const repo = invRepo(ctx);
      const matched = await repo.findByOcr(ocr);
      if (!matched) throw new NotFound("Ingen faktura med det OCR-numret");

      let current = matched;
      const guard = new Set<number>([current.id]);
      while (current.superseded_by_invoice_id) {
        const next = await repo.findByIdBasic(current.superseded_by_invoice_id);
        if (!next || guard.has(next.id)) break;
        guard.add(next.id);
        current = next;
      }

      const paidOre = await repo.paidOre(current.id);
      const totalInclVatOre = Number(current.total_incl_vat_ore);
      return {
        matchedInvoiceId: matched.id,
        currentInvoiceId: current.id,
        ocr,
        customerId: current.customer_id,
        status: current.status,
        currency: current.currency,
        totalInclVatOre,
        paidOre,
        remainingOre: totalInclVatOre - paidOre,
      };
    },
  };
}

export type InvoiceService = ReturnType<typeof createInvoiceService>;

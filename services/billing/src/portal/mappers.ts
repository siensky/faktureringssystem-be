// Databasrad -> API-form. Öre -> kronor sist (database.md #8) — samma
// konvention som invoices/mappers.ts.

import type {
  PortalInvoiceDetailDto,
  PortalInvoiceLineDto,
  PortalInvoiceSummaryDto,
  PortalInvoiceTemplateDto,
} from "@faktura/contracts";
import { computeLine, sumTotals } from "../domain/vat";
import type {
  AccountSummaryRow,
  PortalInvoiceItemRow,
  PortalInvoiceRow,
  PortalInvoiceTemplateRow,
} from "./types";

const kr = (ore: string | number): number => Number(ore) / 100;

export function toSummary(row: PortalInvoiceRow): PortalInvoiceSummaryDto {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    ocrNumber: row.ocr_number,
    invoiceType: row.invoice_type,
    status: row.status,
    deliveryStatus: row.delivery_status,
    dateIssued: row.date_issued,
    dateDue: row.date_due,
    currency: row.currency,
    totalInclVat: kr(row.total_incl_vat_ore),
  };
}

function toLine(item: PortalInvoiceItemRow): PortalInvoiceLineDto {
  return {
    position: item.position,
    description: item.description,
    quantity: Number(item.quantity),
    unit: item.unit,
    unitPrice: kr(item.unit_price_ore),
    vatRate: Number(item.vat_rate),
    lineExclVat: kr(item.line_excl_vat_ore),
    lineVat: kr(item.line_vat_ore),
    lineInclVat: kr(item.line_incl_vat_ore),
  };
}

export function toDetail(
  row: PortalInvoiceRow,
  items: PortalInvoiceItemRow[],
  paidOre: number,
): PortalInvoiceDetailDto {
  const remainingOre = Number(row.total_incl_vat_ore) - paidOre;
  return {
    ...toSummary(row),
    totalExclVat: kr(row.total_excl_vat_ore),
    totalVat: kr(row.total_vat_ore),
    paid: kr(paidOre),
    remaining: kr(remainingOre),
    sentAt: row.sent_at ? row.sent_at.toISOString() : null,
    lines: items.map(toLine),
  };
}

export function toAccountSummary(row: AccountSummaryRow) {
  return {
    outstanding: kr(row.outstanding_ore),
    outstandingInvoiceCount: row.outstanding_count,
  };
}

/** Samma momsberäkning som en riktig faktura, bara för visning — mallen
 *  bär inga egna öresfält, bara de råa radangivelserna. */
export function toPortalTemplate(row: PortalInvoiceTemplateRow): PortalInvoiceTemplateDto {
  const amounts = row.template_data.lines.map((line) => computeLine(line));
  return {
    id: row.id,
    interval: row.interval,
    nextGenerationDate: row.next_generation_date,
    currency: row.template_data.currency ?? "SEK",
    totalInclVat: kr(sumTotals(amounts).totalInclVatOre),
  };
}

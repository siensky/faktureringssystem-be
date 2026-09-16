// Databasrad -> API-form. Belopp öre -> kronor sista steget (database.md
// #8). Snapshoten är undantaget: den är den frusna interna posten som
// documents renderar PDF ur, och håller öre kvar som öre för exakthet.

import type { InvoiceDetailDto, InvoiceLineDto, InvoiceSummaryDto } from "@faktura/contracts";
import type { JsonObject } from "@faktura/shared";
import type { CompanySettingsRow } from "../company-settings/types";
import type { CustomerRow } from "../customers/types";
import type { InvoiceListRow } from "./repository";
import type { InvoiceItemRow, InvoiceRow } from "./types";

const kr = (ore: string | number): number => Number(ore) / 100;

// Ingen explicit returtyp på dessa tre (medvetet, avviker från code-style.md
// #19): returvärdet flödar in i JsonValue-typade slots (idempotency.ts). Ett
// namngivet interface saknar implicit index-signatur och skulle bryta den
// typningen — `satisfies` ger samma kompileringsskydd (en mapper som glider
// bort från kontraktet slutar typechecka) utan det problemet.
export function toLineView(item: InvoiceItemRow) {
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
  } satisfies InvoiceLineDto;
}

export function toSummary(row: InvoiceListRow) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    ocrNumber: row.ocr_number,
    invoiceType: row.invoice_type,
    status: row.status,
    deliveryStatus: row.delivery_status,
    customerId: row.customer_id,
    customerName: row.customer_name,
    dateIssued: row.date_issued,
    dateDue: row.date_due,
    currency: row.currency,
    totalInclVat: kr(row.total_incl_vat_ore),
  } satisfies InvoiceSummaryDto;
}

export function toDetail(row: InvoiceListRow, items: InvoiceItemRow[], paidOre: number) {
  const remainingOre = Number(row.total_incl_vat_ore) - paidOre;
  return {
    ...toSummary(row),
    totalExclVat: kr(row.total_excl_vat_ore),
    totalVat: kr(row.total_vat_ore),
    paid: kr(paidOre),
    remaining: kr(remainingOre),
    sentAt: row.sent_at ? row.sent_at.toISOString() : null,
    creditsInvoiceId: row.credits_invoice_id,
    remindsInvoiceId: row.reminds_invoice_id,
    supersededByInvoiceId: row.superseded_by_invoice_id,
    lines: items.map(toLineView),
  } satisfies InvoiceDetailDto;
}

/** Frusen kopia för PDF-rendering. Id:n + råa öre, självständig av levande tabeller. */
export function buildSnapshotPayload(input: {
  invoice: InvoiceRow;
  items: InvoiceItemRow[];
  company: CompanySettingsRow;
  customer: CustomerRow;
}): JsonObject {
  const { invoice, items, company, customer } = input;
  return {
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      ocrNumber: invoice.ocr_number,
      invoiceType: invoice.invoice_type,
      dateIssued: invoice.date_issued,
      dateDue: invoice.date_due,
      currency: invoice.currency,
      totalExclVatOre: Number(invoice.total_excl_vat_ore),
      totalVatOre: Number(invoice.total_vat_ore),
      totalInclVatOre: Number(invoice.total_incl_vat_ore),
    },
    company: {
      name: company.company_name,
      orgNumber: company.org_number,
      bankgiro: company.bankgiro,
      vatNumber: company.vat_number,
      address: {
        street: company.address_street,
        zip: company.address_zip,
        city: company.address_city,
      },
      logoUrl: company.logo_url,
    },
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      // Läst FÄRSKT vid send/credit, inte frusen — documents använder den
      // för att avgöra om ett nytt utskick ens ska försökas (domain.md
      // #23: en hård studs ska stoppa FRAMTIDA utskick, inte bara det som
      // bounce:ade). customers är billings tabell; det här är den enda
      // vägen documents kan känna till flaggan (architecture.md #2 — ingen
      // JOIN över tjänstegränsen).
      emailValid: customer.email_valid,
      customerType: customer.customer_type,
      orgNumber: customer.org_number,
      address: {
        street: customer.address_street,
        zip: customer.address_zip,
        city: customer.address_city,
      },
    },
    lines: items.map((it) => ({
      position: it.position,
      description: it.description,
      quantity: Number(it.quantity),
      unit: it.unit,
      unitPriceOre: Number(it.unit_price_ore),
      vatRate: Number(it.vat_rate),
      lineExclVatOre: Number(it.line_excl_vat_ore),
      lineVatOre: Number(it.line_vat_ore),
      lineInclVatOre: Number(it.line_incl_vat_ore),
    })),
  };
}

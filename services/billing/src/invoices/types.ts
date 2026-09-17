import type { CreateCustomerInput } from "../customers/types";
import type { RecurrenceInterval } from "../domain/dates";
import type { VatRate } from "../domain/vat";

export type InvoiceType = "invoice" | "credit_note" | "reminder";
export type InvoiceStatus =
  | "draft"
  | "sent"
  | "paid"
  | "overdue"
  | "credited"
  | "superseded"
  | "settled";
export type DeliveryStatus = "none" | "queued" | "sent" | "delivered" | "bounced" | "failed";

export interface InvoiceRow {
  id: number;
  tenant_id: number;
  customer_id: number;
  // NULL på utkast; tilldelas vid send/credit.
  invoice_number: number | null;
  ocr_number: string | null;
  invoice_type: InvoiceType;
  status: InvoiceStatus;
  delivery_status: DeliveryStatus;
  date_issued: string;
  date_due: string;
  currency: string;
  total_excl_vat_ore: string;
  total_vat_ore: string;
  total_incl_vat_ore: string;
  credits_invoice_id: number | null;
  reminds_invoice_id: number | null;
  superseded_by_invoice_id: number | null;
  parent_template_id: number | null;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface InvoiceItemRow {
  id: number;
  invoice_id: number;
  tenant_id: number;
  position: number;
  description: string;
  quantity: string;
  unit: string;
  unit_price_ore: string;
  vat_rate: string;
  line_excl_vat_ore: string;
  line_vat_ore: string;
  line_incl_vat_ore: string;
  created_at: Date;
}

export interface LineInputDto {
  description: string;
  /** Antal — får vara bråktal (t.ex. 2,5 timmar), upp till tre decimaler. */
  quantity: number;
  /** Styckpris i HELTAL öre (belopp kommer in i öre vid gränsen, database.md #6). */
  unitPriceOre: number;
  vatRate: VatRate;
  unit?: string;
}

export interface CreateInvoiceInput {
  /** Exakt en av customerId/customer — schema.ts (oneOf) garanterar det, services.ts kollar igen. */
  customerId?: number;
  /** Ny kund, skapad i samma transaktion som fakturan (services.ts). */
  customer?: CreateCustomerInput;
  dateIssued?: string;
  dateDue?: string;
  currency?: string;
  lines: LineInputDto[];
}

export interface UpdateInvoiceInput {
  dateIssued?: string;
  dateDue?: string;
  currency?: string;
  lines?: LineInputDto[];
}

// Fas 6: innehållet i invoice_templates.template_data (JSONB). Speglar
// CreateInvoiceInput minus datum — de räknas fram FÄRSKT vid varje
// generering utifrån next_generation_date och kundens betalningsvillkor,
// inte frusna i mallen (databasen har ingen egen skapare/API för mallar
// ännu, se PR-beskrivningen).
export interface TemplateData {
  customerId: number;
  currency?: string;
  lines: LineInputDto[];
}

export interface InvoiceTemplateRow {
  id: number;
  tenant_id: number;
  customer_id: number;
  interval: RecurrenceInterval;
  next_generation_date: string;
  // Ursprungligt, ALDRIG klampat ankardygn (1-31) — migrations/0007. Se
  // advanceByInterval för varför det måste hållas isär från
  // next_generation_date (kodgranskning PR #6, fynd 3).
  billing_day: number;
  is_active: boolean;
  template_data: TemplateData;
  created_at: Date;
  updated_at: Date;
}

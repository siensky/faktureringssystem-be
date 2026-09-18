import type { RecurrenceInterval } from "../domain/dates";
import type { DeliveryStatus, InvoiceStatus, InvoiceType, TemplateData } from "../invoices/types";

// Samma rader som billings egna InvoiceRow/InvoiceItemRow (invoices/types.ts)
// — portalen läser samma tabeller, bara kund-scopade i stället för admin-
// scopade. Inget eget schema behövs.
export interface PortalInvoiceRow {
  id: number;
  tenant_id: number;
  customer_id: number;
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
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PortalInvoiceItemRow {
  position: number;
  description: string;
  quantity: string;
  unit: string;
  unit_price_ore: string;
  vat_rate: string;
  line_excl_vat_ore: string;
  line_vat_ore: string;
  line_incl_vat_ore: string;
}

export interface AccountSummaryRow {
  outstanding_ore: string;
  outstanding_count: number;
}

/** Fas 13: kundens egna (aktiva) mallar — read-only läsvy, portalen skapar/ändrar aldrig en. */
export interface PortalInvoiceTemplateRow {
  id: number;
  interval: RecurrenceInterval;
  next_generation_date: string;
  is_active: boolean;
  template_data: TemplateData;
}

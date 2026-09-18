// REST-form av faktura-endpoints i billing (services/billing/src/invoices).
// Delas med apps/backoffice. Belopp är kronor (number) här — mapparna
// konverterar öre -> kronor sist, precis vid API-gränsen (database.md #8).

import type { CreateCustomerInput } from "./customers";

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
export type VatRate = 0 | 6 | 12 | 25;

export interface InvoiceSummaryDto {
  id: number;
  invoiceNumber: number | null;
  ocrNumber: string | null;
  invoiceType: InvoiceType;
  status: InvoiceStatus;
  deliveryStatus: DeliveryStatus;
  customerId: number;
  customerName: string;
  dateIssued: string;
  dateDue: string;
  currency: string;
  totalInclVat: number;
}

export interface InvoiceLineDto {
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  vatRate: number;
  lineExclVat: number;
  lineVat: number;
  lineInclVat: number;
}

export interface InvoiceDetailDto extends InvoiceSummaryDto {
  totalExclVat: number;
  totalVat: number;
  paid: number;
  remaining: number;
  sentAt: string | null;
  creditsInvoiceId: number | null;
  remindsInvoiceId: number | null;
  supersededByInvoiceId: number | null;
  lines: InvoiceLineDto[];
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
  /** Exakt en av customerId/customer — servern avvisar annars. */
  customerId?: number;
  /** Ny kund, skapas i samma anrop som fakturan. */
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

// Fas 13: återkommande fakturor (admin-CRUD på invoice_templates — själva
// genereringen fanns redan sedan fas 6). En mall bär inga egna öresfält,
// bara samma LineInputDto[] som en fakturas skapande gör; totalInclVat är
// ett förhandsbelopp servern räknar fram för visning.
export type RecurrenceInterval = "monthly" | "quarterly" | "yearly";

export interface InvoiceTemplateSummaryDto {
  id: number;
  customerId: number;
  customerName: string;
  interval: RecurrenceInterval;
  nextGenerationDate: string;
  isActive: boolean;
  currency: string;
  totalInclVat: number;
}

export interface InvoiceTemplateDetailDto extends InvoiceTemplateSummaryDto {
  lines: LineInputDto[];
}

export interface CreateInvoiceTemplateInput {
  customerId: number;
  interval: RecurrenceInterval;
  nextGenerationDate: string;
  currency?: string;
  lines: LineInputDto[];
}

export interface UpdateInvoiceTemplateInput {
  interval?: RecurrenceInterval;
  nextGenerationDate?: string;
  currency?: string;
  lines?: LineInputDto[];
  isActive?: boolean;
}

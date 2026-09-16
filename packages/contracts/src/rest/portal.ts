// REST-form av kundportalen (fas 9, services/billing/src/portal och
// services/auth/src/auth — customer-invites). Belopp är kronor (number),
// samma mapper-konvention som rest/invoices.ts (database.md #8).

import type { DeliveryStatus, InvoiceStatus, InvoiceType } from "./invoices";

/** GET /portal/invoices — samma fält som admins InvoiceSummaryDto minus
 *  customerId/customerName (kunden vet redan vem den är). */
export interface PortalInvoiceSummaryDto {
  id: number;
  invoiceNumber: number | null;
  ocrNumber: string | null;
  invoiceType: InvoiceType;
  status: InvoiceStatus;
  deliveryStatus: DeliveryStatus;
  dateIssued: string;
  dateDue: string;
  currency: string;
  totalInclVat: number;
}

export interface PortalInvoiceLineDto {
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

export interface PortalInvoiceDetailDto extends PortalInvoiceSummaryDto {
  totalExclVat: number;
  totalVat: number;
  paid: number;
  remaining: number;
  sentAt: string | null;
  lines: PortalInvoiceLineDto[];
}

/** GET /portal/invoices/:id/pdf — tidsbegränsad, signerad S3-URL (domain.md #19). */
export interface PortalInvoicePdfDto {
  url: string;
  expiresAt: string;
}

/** GET /portal/account-summary — domain.md #33: status IN ('sent','overdue')
 *  räknar en påminnelsekedja exakt en gång (originalet är 'superseded'). */
export interface PortalAccountSummaryDto {
  outstandingOre: number;
  outstandingInvoiceCount: number;
}

/** POST /auth/customer-invites (admin, i auth-tjänsten). */
export interface CreateCustomerInviteInput {
  customerId: number;
  email: string;
}

/** POST /auth/accept-customer-invite (publik, engångslänk). */
export interface AcceptCustomerInviteInput {
  token: string;
  password: string;
}

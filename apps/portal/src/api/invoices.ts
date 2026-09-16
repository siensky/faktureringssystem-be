import type {
  PortalAccountSummaryDto,
  PortalInvoiceDetailDto,
  PortalInvoicePdfDto,
  PortalInvoiceSummaryDto,
} from "@faktura/contracts";
import { apiRequest } from "./client";

// Ingen sidbläddring (jfr apps/backoffice/src/lib/useOffsetList.ts) — en
// enskild kunds fakturalista är av en helt annan storleksordning än en
// hel tenants (architecture.md #24, "den tråkiga lösningen"). Backend
// cappar ändå hårt (services/billing/src/portal/services.ts).
const LIMIT = 200;

export function listInvoices(): Promise<PortalInvoiceSummaryDto[]> {
  return apiRequest(`/portal/invoices?limit=${LIMIT}`);
}

export function getInvoice(id: number): Promise<PortalInvoiceDetailDto> {
  return apiRequest(`/portal/invoices/${id}`);
}

export function getInvoicePdfUrl(id: number): Promise<PortalInvoicePdfDto> {
  return apiRequest(`/portal/invoices/${id}/pdf`);
}

export function getAccountSummary(): Promise<PortalAccountSummaryDto> {
  return apiRequest("/portal/account-summary");
}

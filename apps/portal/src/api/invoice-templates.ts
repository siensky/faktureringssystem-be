import type { PortalInvoiceTemplateDto } from "@faktura/contracts";
import { apiRequest } from "./client";

/** Kundens egna aktiva återkommande fakturor — skrivskyddat, se rules/domain.md. */
export function listInvoiceTemplates(): Promise<PortalInvoiceTemplateDto[]> {
  return apiRequest("/portal/invoice-templates");
}

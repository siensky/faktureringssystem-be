import type {
  CreateInvoiceTemplateInput,
  InvoiceTemplateDetailDto,
  InvoiceTemplateSummaryDto,
  UpdateInvoiceTemplateInput,
} from "@faktura/contracts";
import { apiRequest } from "./client";

export function listInvoiceTemplates(): Promise<InvoiceTemplateSummaryDto[]> {
  return apiRequest("/admin/invoice-templates");
}

export function getInvoiceTemplate(id: number): Promise<InvoiceTemplateDetailDto> {
  return apiRequest(`/admin/invoice-templates/${id}`);
}

export function createInvoiceTemplate(
  input: CreateInvoiceTemplateInput,
  idempotencyKey: string,
): Promise<InvoiceTemplateDetailDto> {
  return apiRequest("/admin/invoice-templates", { method: "POST", body: input, idempotencyKey });
}

export function updateInvoiceTemplate(
  id: number,
  input: UpdateInvoiceTemplateInput,
): Promise<InvoiceTemplateDetailDto> {
  return apiRequest(`/admin/invoice-templates/${id}`, { method: "PUT", body: input });
}

export function deleteInvoiceTemplate(id: number): Promise<{ status: "ok" }> {
  return apiRequest(`/admin/invoice-templates/${id}`, { method: "DELETE" });
}

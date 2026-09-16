import type {
  CreateInvoiceInput,
  DeliveryStatus,
  InvoiceDetailDto,
  InvoiceStatus,
  InvoiceSummaryDto,
  UpdateInvoiceInput,
} from "@faktura/contracts";
import { apiRequest } from "./client";

export interface InvoiceListResponse {
  items: InvoiceSummaryDto[];
  hasMore: boolean;
}

export function listInvoices(status?: InvoiceStatus): Promise<InvoiceListResponse> {
  const query = status ? `?status=${status}&limit=200` : "?limit=200";
  return apiRequest(`/admin/invoices${query}`);
}

export function listDeliveries(status?: DeliveryStatus): Promise<InvoiceListResponse> {
  const query = status ? `?status=${status}&limit=200` : "?limit=200";
  return apiRequest(`/admin/deliveries${query}`);
}

export function getInvoice(id: number): Promise<InvoiceDetailDto> {
  return apiRequest(`/admin/invoices/${id}`);
}

export function createInvoice(
  input: CreateInvoiceInput,
  idempotencyKey: string,
): Promise<InvoiceDetailDto> {
  return apiRequest("/admin/invoices", { method: "POST", body: input, idempotencyKey });
}

export function updateInvoice(id: number, input: UpdateInvoiceInput): Promise<InvoiceDetailDto> {
  return apiRequest(`/admin/invoices/${id}`, { method: "PUT", body: input });
}

export function deleteInvoice(id: number): Promise<{ status: "ok" }> {
  return apiRequest(`/admin/invoices/${id}`, { method: "DELETE" });
}

export function sendInvoice(id: number, idempotencyKey: string): Promise<InvoiceDetailDto> {
  return apiRequest(`/admin/invoices/${id}/send`, { method: "POST", body: {}, idempotencyKey });
}

export function creditInvoice(id: number, idempotencyKey: string): Promise<InvoiceDetailDto> {
  return apiRequest(`/admin/invoices/${id}/credit`, { method: "POST", body: {}, idempotencyKey });
}

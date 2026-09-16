import type {
  CreateInvoiceInput,
  DeliveryStatus,
  InvoiceDetailDto,
  InvoiceStatus,
  InvoiceSummaryDto,
  UpdateInvoiceInput,
} from "@faktura/contracts";
import { PAGE_SIZE } from "../lib/pagination";
import { apiRequest } from "./client";

export interface InvoiceListResponse {
  items: InvoiceSummaryDto[];
  hasMore: boolean;
}

function listQuery(status: string | undefined, offset: number): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (status) params.set("status", status);
  return params.toString();
}

export function listInvoices(status?: InvoiceStatus, offset = 0): Promise<InvoiceListResponse> {
  return apiRequest(`/admin/invoices?${listQuery(status, offset)}`);
}

export function listDeliveries(status?: DeliveryStatus, offset = 0): Promise<InvoiceListResponse> {
  return apiRequest(`/admin/deliveries?${listQuery(status, offset)}`);
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

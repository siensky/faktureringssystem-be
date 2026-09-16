import type { CreateCustomerInput, CustomerDto, UpdateCustomerInput } from "@faktura/contracts";
import { PAGE_SIZE } from "../lib/pagination";
import { apiRequest } from "./client";

export interface CustomerListResponse {
  items: CustomerDto[];
  hasMore: boolean;
}

export function listCustomers(offset = 0): Promise<CustomerListResponse> {
  return apiRequest(`/admin/customers?limit=${PAGE_SIZE}&offset=${offset}`);
}

export function getCustomer(id: number): Promise<CustomerDto> {
  return apiRequest(`/admin/customers/${id}`);
}

export function createCustomer(
  input: CreateCustomerInput,
  idempotencyKey: string,
): Promise<CustomerDto> {
  return apiRequest("/admin/customers", { method: "POST", body: input, idempotencyKey });
}

export function updateCustomer(id: number, input: UpdateCustomerInput): Promise<CustomerDto> {
  return apiRequest(`/admin/customers/${id}`, { method: "PUT", body: input });
}

export function deleteCustomer(id: number): Promise<{ status: "ok" }> {
  return apiRequest(`/admin/customers/${id}`, { method: "DELETE" });
}

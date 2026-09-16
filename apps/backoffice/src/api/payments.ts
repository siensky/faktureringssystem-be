import type { UnmatchedTransactionDto } from "@faktura/contracts";
import { apiRequest } from "./client";

export function listUnmatched(): Promise<{ items: UnmatchedTransactionDto[] }> {
  return apiRequest("/admin/payments/unmatched");
}

export function matchTransaction(
  id: number,
  invoiceId: number,
  idempotencyKey: string,
  acceptOverpayment = false,
): Promise<{ status: "matched"; id: number; invoiceId: number }> {
  return apiRequest(`/admin/payments/${id}/match`, {
    method: "POST",
    body: { invoiceId, acceptOverpayment },
    idempotencyKey,
  });
}

export function ignoreTransaction(
  id: number,
  reason: string,
  idempotencyKey: string,
): Promise<{ status: "ignored"; id: number }> {
  return apiRequest(`/admin/payments/${id}/ignore`, {
    method: "POST",
    body: { reason },
    idempotencyKey,
  });
}

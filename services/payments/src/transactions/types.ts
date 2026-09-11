export type BankTransactionSource = "bgmax" | "webhook:mockbank";
export type BankTransactionStatus = "matched" | "unmatched" | "manual_review" | "ignored";
export type UnmatchedReason = "unknown_bankgiro" | "unknown_ocr" | "overpayment" | "ambiguous";

/** Formen migrations/0006_payments.js:s bank_transactions_status_shape kräver. */
export interface BankTransactionInsert {
  tenantId: number | null;
  source: BankTransactionSource;
  externalId: string;
  bankgiro: string;
  ocr: string;
  payerName: string | null;
  amountOre: number;
  bookedAt: Date;
  status: BankTransactionStatus;
  unmatchedReason: UnmatchedReason | null;
  matchedInvoiceId: number | null;
}

export interface BankTransactionRow {
  id: number;
  tenant_id: number | null;
  source: BankTransactionSource;
  external_id: string;
  bankgiro: string;
  ocr: string;
  payer_name: string | null;
  amount_ore: string;
  booked_at: Date;
  received_at: Date;
  updated_at: Date;
  status: BankTransactionStatus;
  unmatched_reason: UnmatchedReason | null;
  matched_invoice_id: number | null;
  ignored_reason: string | null;
}

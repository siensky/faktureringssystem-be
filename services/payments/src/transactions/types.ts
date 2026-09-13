export type BankTransactionSource = "bgmax" | "webhook:mockbank";
/**
 * 'pending' = raden är skriven (dedup-nyckeln är tagen) men beslutet är
 * INTE fattat än. Matchningsmotorn skriver alltid ALLA nya rader i det
 * här läget innan den ens ringer billing — se matching/service.ts.
 */
export type BankTransactionStatus =
  | "pending"
  | "matched"
  | "unmatched"
  | "manual_review"
  | "ignored";
export type UnmatchedReason = "unknown_bankgiro" | "unknown_ocr" | "overpayment" | "ambiguous";

/** Raden som skrivs vid intag, innan matchningsmotorn fattat ett beslut. */
export interface BankTransactionIntake {
  source: BankTransactionSource;
  externalId: string;
  bankgiro: string;
  ocr: string;
  payerName: string | null;
  amountOre: number;
  bookedAt: Date;
}

/** Beslutet som löser en 'pending'-rad till ett slutgiltigt läge. */
export interface BankTransactionDecision {
  tenantId: number | null;
  status: Exclude<BankTransactionStatus, "pending">;
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

import type { BankTransactionStatus, UnmatchedReason } from "../transactions/types";

export interface UnmatchedTransactionRow {
  id: number;
  bankgiro: string;
  ocr: string;
  payer_name: string | null;
  amount_ore: string;
  booked_at: Date;
  received_at: Date;
  unmatched_reason: UnmatchedReason | null;
}

export interface BankTransactionForUpdate {
  id: number;
  tenant_id: number | null;
  status: BankTransactionStatus;
  amount_ore: string;
  booked_at: Date;
}

export interface MatchBody {
  invoiceId: number;
}

export interface IgnoreBody {
  reason: string;
}

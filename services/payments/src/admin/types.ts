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
  /**
   * Krävs (måste vara true) för att bokföra en rad vars belopp
   * överstiger fakturans kvarstående belopp — utan den 422:ar en
   * överbetalning fortfarande, precis som innan (PR-granskning fas 5,
   * punkt 4). Medvetet val, inte ett automatiskt beteende.
   */
  acceptOverpayment?: boolean;
}

export interface IgnoreBody {
  reason: string;
}

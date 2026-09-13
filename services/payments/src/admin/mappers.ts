import type { UnmatchedTransactionRow } from "./types";

export interface UnmatchedTransactionDto {
  id: number;
  bankgiro: string;
  ocr: string;
  payerName: string | null;
  amountOre: number;
  bookedAt: string;
  receivedAt: string;
  unmatchedReason: string | null;
}

export function toUnmatchedDto(row: UnmatchedTransactionRow): UnmatchedTransactionDto {
  return {
    id: row.id,
    bankgiro: row.bankgiro,
    ocr: row.ocr,
    payerName: row.payer_name,
    // BIGINT-kolumn -> postgres.js ger en sträng.
    amountOre: Number(row.amount_ore),
    bookedAt: row.booked_at.toISOString(),
    receivedAt: row.received_at.toISOString(),
    unmatchedReason: row.unmatched_reason,
  };
}

import type { UnmatchedTransactionDto } from "@faktura/contracts";
import type { UnmatchedTransactionRow } from "./types";

// Ingen explicit returtyp (medvetet, avviker från code-style.md #19): se
// samma kommentar i services/billing/src/invoices/mappers.ts — `satisfies`
// ger kompileringsskyddet (glider formen bort från kontraktet slutar den
// typechecka) utan att ett namngivet interface saknar index-signatur.
export function toUnmatchedDto(row: UnmatchedTransactionRow) {
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
  } satisfies UnmatchedTransactionDto;
}

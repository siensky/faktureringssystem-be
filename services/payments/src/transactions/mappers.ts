import type { UnknownBankgiroRow } from "./repository";
import type { BankTransactionStatus } from "./types";

export interface UnknownBankgiroDto {
  id: number;
  bankgiro: string;
  ocr: string;
  payerName: string | null;
  amountOre: number;
  receivedAt: string;
  /**
   * 'unmatched' = definitivt inget känt bankgiro. 'pending' = ett
   * beslutsförsök har inte slutförts än (t.ex. ett billing-avbrott
   * mitt i matchningen, PR-granskning fas 5 punkt 2) — en omleverans
   * av samma händelse/rad löser den, ingen manuell åtgärd krävs bara
   * för att den syns här.
   */
  status: BankTransactionStatus;
}

export function toUnknownBankgiroDto(row: UnknownBankgiroRow): UnknownBankgiroDto {
  return {
    id: row.id,
    bankgiro: row.bankgiro,
    ocr: row.ocr,
    payerName: row.payer_name,
    amountOre: Number(row.amount_ore),
    receivedAt: row.received_at.toISOString(),
    status: row.status,
  };
}

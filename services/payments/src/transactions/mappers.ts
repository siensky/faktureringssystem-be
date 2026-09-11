import type { UnknownBankgiroRow } from "./repository";

export interface UnknownBankgiroDto {
  id: number;
  bankgiro: string;
  ocr: string;
  payerName: string | null;
  amountOre: number;
  receivedAt: string;
}

export function toUnknownBankgiroDto(row: UnknownBankgiroRow): UnknownBankgiroDto {
  return {
    id: row.id,
    bankgiro: row.bankgiro,
    ocr: row.ocr,
    payerName: row.payer_name,
    amountOre: Number(row.amount_ore),
    receivedAt: row.received_at.toISOString(),
  };
}

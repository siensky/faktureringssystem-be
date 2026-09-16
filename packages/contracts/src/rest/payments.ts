// REST-form av den manuella matchningskön i payments
// (services/payments/src/admin). Delas med apps/backoffice.

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

export interface MatchBody {
  invoiceId: number;
  /** Krävs (true) för att bokföra en rad vars belopp överstiger fakturans kvarstående belopp. */
  acceptOverpayment?: boolean;
}

export interface IgnoreBody {
  reason: string;
}

import type {
  BankTransactionSource,
  BankTransactionStatus,
  UnmatchedReason,
} from "../transactions/types";

/**
 * Minsta möjliga yta mot billing som matchningsmotorn behöver — smalare
 * än den faktiska BillingClient-klassen, så testerna kan injicera en
 * fejk utan att röra HTTP/Redis/tokens alls (fas 5-planen, avsnitt 3).
 */
export interface MatchingBillingClient {
  resolveTenantByBankgiro(bankgiro: string, correlationId: string): Promise<number | undefined>;
  resolveInvoiceByOcr(
    tenantId: number,
    ocr: string,
    correlationId: string,
  ): Promise<InvoiceForMatching | undefined>;
}

export interface InvoiceForMatching {
  currentInvoiceId: number;
  status: string;
  remainingOre: number;
}

export interface MatchInput {
  source: BankTransactionSource;
  externalId: string;
  bankgiro: string;
  ocr: string;
  amountOre: number;
  payerName: string | null;
  bookedAt: Date;
  correlationId: string;
}

export type MatchOutcome =
  | { kind: "duplicate" }
  | {
      kind: "written";
      id: number;
      status: Exclude<BankTransactionStatus, "pending">;
      tenantId: number | null;
      unmatchedReason: UnmatchedReason | null;
      matchedInvoiceId: number | null;
    };

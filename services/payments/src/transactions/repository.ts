// ALL SQL för bank_transactions skrivsidan, delad av webhook- och
// filimportvägen (database.md #22). INTE tenant-scopad via
// TenantScopedRepository: tenant_id är okänt fram till matchningsmotorns
// bankgiro-uppslag, och kan vara NULL (unknown_bankgiro). Den tenant-
// scopade läsningen för admin-kön ligger i services/payments/src/admin/
// repository.ts i stället.

import type { Sql, TransactionSql } from "postgres";
import type { BankTransactionInsert } from "./types";

export interface UnknownBankgiroRow {
  id: number;
  bankgiro: string;
  ocr: string;
  payer_name: string | null;
  amount_ore: string;
  received_at: Date;
}

export class BankTransactionRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Billigt förhandstest INNAN några S2S-anrop görs (matchningsmotorns
   * steg 1) — en omleverans av en redan bokförd transaktion ska inte
   * behöva slå upp bankgiro/OCR mot billing i onödan. Den FAKTISKA
   * dedupen sker ändå i insertIfNew (ON CONFLICT), det här är bara en
   * optimering.
   */
  async existsDuplicate(source: string, externalId: string): Promise<boolean> {
    const [row] = await this.sql`
      SELECT 1 FROM bank_transactions
      WHERE source = ${source} AND external_id = ${externalId}
      LIMIT 1
    `;
    return row !== undefined;
  }

  /**
   * Skriver raden med det FÄRDIGA beslutet från matchningsmotorn.
   * ON CONFLICT (source, external_id) DO NOTHING — en dubblettleverans
   * skriver noll rader (returnerar undefined), och anroparen publicerar
   * då inget event heller (fas 5-planens löfte om att en omsänd
   * leverans är ett no-op). Kör alltid i den medskickade transaktionen
   * — se matching/service.ts för varför insert och eventpublicering hör
   * ihop.
   */
  async insertIfNew(tx: TransactionSql, data: BankTransactionInsert): Promise<number | undefined> {
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO bank_transactions (
        tenant_id, source, external_id, bankgiro, ocr, payer_name, amount_ore,
        booked_at, status, unmatched_reason, matched_invoice_id
      ) VALUES (
        ${data.tenantId}, ${data.source}, ${data.externalId}, ${data.bankgiro}, ${data.ocr},
        ${data.payerName}, ${data.amountOre}, ${data.bookedAt}, ${data.status},
        ${data.unmatchedReason}, ${data.matchedInvoiceId}
      )
      ON CONFLICT (source, external_id) DO NOTHING
      RETURNING id
    `;
    return row?.id;
  }

  /**
   * Driftvyn: rader utan tenant (unknown_bankgiro), utanför tenant-
   * modellen (GET /internal/ops/payments/unknown-bankgiro). Osynlig via
   * alla tenant-scopade /admin/payments/*-vägar per konstruktion — den
   * frågan filtrerar alltid på tenant_id = <känd tenant>, och NULL
   * matchar aldrig en jämförelse mot ett konkret värde i SQL.
   */
  async listUnknownBankgiro(): Promise<UnknownBankgiroRow[]> {
    return this.sql<UnknownBankgiroRow[]>`
      SELECT id, bankgiro, ocr, payer_name, amount_ore, received_at
      FROM bank_transactions
      WHERE tenant_id IS NULL
      ORDER BY received_at
    `;
  }
}

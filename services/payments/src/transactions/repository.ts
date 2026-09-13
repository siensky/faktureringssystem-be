// ALL SQL för bank_transactions skrivsidan, delad av webhook- och
// filimportvägen (database.md #22). INTE tenant-scopad via
// TenantScopedRepository: tenant_id är okänt fram till matchningsmotorns
// bankgiro-uppslag, och kan vara NULL (unknown_bankgiro). Den tenant-
// scopade läsningen för admin-kön ligger i services/payments/src/admin/
// repository.ts i stället.
//
// Skrivningen sker i TVÅ steg (PR-granskning fas 5, punkt 2; domain.md
// #14 — en obetalbar/oavgjord transaktion får aldrig tappas tyst):
//   1. intake() skriver raden i status 'pending' INNAN matchningsmotorn
//      ringer billing. Pengarna är nu spårade oavsett vad som händer
//      härnäst.
//   2. resolvePending() löser den till ett slutgiltigt läge EFTER
//      billing svarat. Kraschar/felar steg 2 (billing nere, nätverk)
//      finns raden kvar som 'pending' — en omleverans av samma
//      (source, external_id) hittar den och försöker bara steg 2 igen.

import type { Sql, TransactionSql } from "postgres";
import type {
  BankTransactionDecision,
  BankTransactionIntake,
  BankTransactionStatus,
} from "./types";

export interface UnknownBankgiroRow {
  id: number;
  bankgiro: string;
  ocr: string;
  payer_name: string | null;
  amount_ore: string;
  received_at: Date;
  status: BankTransactionStatus;
}

export interface IntakeResult {
  id: number;
  /** Status på den hittade/skapade raden. 'pending' betyder: fortsätt till beslutssteget. */
  status: BankTransactionStatus;
}

export class BankTransactionRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Skriver den RÅA transaktionen i status 'pending', eller hittar en
   * redan existerande rad för samma (source, external_id). ON CONFLICT
   * DO NOTHING + en efterföljande SELECT i stället för en enda fråga:
   * postgres.js/Postgres har ingen "INSERT ... ON CONFLICT DO NOTHING
   * RETURNING <existing row on conflict>"-variant, så konflikten måste
   * läsas separat. Ofarligt race: om raden hinner försvinna mellan de
   * två frågorna (kan bara ske via en radering, och bank_transactions
   * raderas aldrig) skulle SELECT:en ge noll rader — se kastet nedan.
   */
  async intake(data: BankTransactionIntake): Promise<IntakeResult> {
    const [inserted] = await this.sql<{ id: number }[]>`
      INSERT INTO bank_transactions (
        source, external_id, bankgiro, ocr, payer_name, amount_ore, booked_at, status
      ) VALUES (
        ${data.source}, ${data.externalId}, ${data.bankgiro}, ${data.ocr},
        ${data.payerName}, ${data.amountOre}, ${data.bookedAt}, 'pending'
      )
      ON CONFLICT (source, external_id) DO NOTHING
      RETURNING id
    `;
    if (inserted) return { id: inserted.id, status: "pending" };

    const [existing] = await this.sql<{ id: number; status: BankTransactionStatus }[]>`
      SELECT id, status FROM bank_transactions
      WHERE source = ${data.source} AND external_id = ${data.externalId}
      LIMIT 1
    `;
    if (!existing) {
      throw new Error(
        `bank_transactions: raden (${data.source}, ${data.externalId}) försvann mellan INSERT och SELECT`,
      );
    }
    return { id: existing.id, status: existing.status };
  }

  /**
   * Löser en 'pending'-rad till dess slutgiltiga läge. Villkorad på
   * status = 'pending' (database.md-mönstret för alla statusövergångar
   * i kodbasen) — returnerar false om raden redan avgjorts av någon
   * annan (extremt smalt race mellan två samtidiga omleveranser av
   * samma event), så anroparen kan behandla det som en dubblett i
   * stället för att skriva över ett redan fattat beslut.
   */
  async resolvePending(
    tx: TransactionSql,
    id: number,
    decision: BankTransactionDecision,
  ): Promise<boolean> {
    const rows = await tx`
      UPDATE bank_transactions
      SET tenant_id = ${decision.tenantId}, status = ${decision.status},
          unmatched_reason = ${decision.unmatchedReason},
          matched_invoice_id = ${decision.matchedInvoiceId}, updated_at = now()
      WHERE id = ${id} AND status = 'pending'
    `;
    return rows.count === 1;
  }

  /**
   * Driftvyn: rader utan tenant — unknown_bankgiro OCH kvarstående
   * pending-rader (samma tenant_id IS NULL-tillstånd innan ett beslut
   * finns) — utanför tenant-modellen (GET /internal/ops/payments/
   * unknown-bankgiro). `status` i svaret skiljer dem åt: en operatör
   * ser om en rad väntar på ett första beslut (pending, t.ex. ett
   * billing-avbrott som inte självläkt via omleverans än) eller
   * definitivt inte matchar något bankgiro (unmatched). Osynlig via
   * alla tenant-scopade /admin/payments/*-vägar per konstruktion — den
   * frågan filtrerar alltid på tenant_id = <känd tenant>, och NULL
   * matchar aldrig en jämförelse mot ett konkret värde i SQL.
   */
  async listUnknownBankgiro(): Promise<UnknownBankgiroRow[]> {
    return this.sql<UnknownBankgiroRow[]>`
      SELECT id, bankgiro, ocr, payer_name, amount_ore, received_at, status
      FROM bank_transactions
      WHERE tenant_id IS NULL
      ORDER BY received_at
    `;
  }
}

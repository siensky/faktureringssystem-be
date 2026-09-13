// ALL SQL för den manuella matchningskön (database.md #22). Tenant-
// filtrerad via TenantScopedRepository — saknas tenant i kontexten kastar
// gettern (fail closed, architecture.md #21).

import { TenantScopedRepository } from "@faktura/shared";
import type { Sql, TransactionSql } from "postgres";
import type { BankTransactionForUpdate, UnmatchedTransactionRow } from "./types";

export class AdminPaymentsRepository extends TenantScopedRepository {
  constructor(
    private readonly sql: Sql,
    ctx: ConstructorParameters<typeof TenantScopedRepository>[0],
  ) {
    super(ctx);
  }

  /** Tenantens manuella kö, äldst först. */
  async listUnmatched(): Promise<UnmatchedTransactionRow[]> {
    return this.sql<UnmatchedTransactionRow[]>`
      SELECT id, bankgiro, ocr, payer_name, amount_ore, booked_at, received_at, unmatched_reason
      FROM bank_transactions
      WHERE tenant_id = ${this.tenantId} AND status = 'manual_review'
      ORDER BY received_at
    `;
  }

  /**
   * Låser raden (database.md #24) inför match/ignore. undefined om raden
   * inte finns för tenanten — 404 över tenant-gränsen, aldrig 403
   * (CLAUDE.md snabbfakta).
   */
  async lockForDecision(
    tx: TransactionSql,
    id: number,
  ): Promise<BankTransactionForUpdate | undefined> {
    const [row] = await tx<BankTransactionForUpdate[]>`
      SELECT id, tenant_id, status, amount_ore, booked_at
      FROM bank_transactions
      WHERE id = ${id} AND tenant_id = ${this.tenantId}
      FOR UPDATE
    `;
    return row;
  }

  /**
   * Villkorad UPDATE: bara från 'manual_review'. Returnerar antalet
   * ändrade rader — 0 betyder att någon annan redan avgjorde raden
   * mellan låsningen och den här skrivningen (bör inte hända under
   * FOR UPDATE, men koden litar aldrig blint på det ensamt).
   */
  async markMatched(tx: TransactionSql, id: number, invoiceId: number): Promise<number> {
    const rows = await tx`
      UPDATE bank_transactions
      SET status = 'matched', matched_invoice_id = ${invoiceId}, unmatched_reason = NULL,
          updated_at = now()
      WHERE id = ${id} AND tenant_id = ${this.tenantId} AND status = 'manual_review'
    `;
    return rows.count;
  }

  async markIgnored(tx: TransactionSql, id: number, reason: string): Promise<number> {
    const rows = await tx`
      UPDATE bank_transactions
      SET status = 'ignored', ignored_reason = ${reason}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${this.tenantId} AND status = 'manual_review'
    `;
    return rows.count;
  }
}

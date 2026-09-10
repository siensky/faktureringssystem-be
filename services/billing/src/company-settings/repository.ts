// ALL SQL för company-settings (database.md #22). company_settings har en
// rad per tenant med tenant_id som PK — den skapas LAT vid första
// skrivningen (PUT, eller en fakturaskickstransaktion), aldrig av en GET.

import { TenantScopedRepository } from "@faktura/shared";
import type { Sql, TransactionSql } from "postgres";
import type { CompanySettingsRow } from "./types";

type Db = Sql | TransactionSql;

export class CompanySettingsRepository extends TenantScopedRepository {
  constructor(
    private readonly sql: Sql,
    ctx: ConstructorParameters<typeof TenantScopedRepository>[0],
  ) {
    super(ctx);
  }

  /** Skapar raden om den saknas och returnerar den. Kör helst i en yttre tx. */
  async lazyGet(db: Db = this.sql): Promise<CompanySettingsRow> {
    await db`
      INSERT INTO company_settings (tenant_id) VALUES (${this.tenantId})
      ON CONFLICT (tenant_id) DO NOTHING
    `;
    const [row] = await db<CompanySettingsRow[]>`
      SELECT * FROM company_settings WHERE tenant_id = ${this.tenantId} LIMIT 1
    `;
    if (!row) throw new Error("company_settings försvann direkt efter upsert");
    return row;
  }

  /** Läser utan att skapa. undefined om tenanten aldrig rört billing. */
  async find(): Promise<CompanySettingsRow | undefined> {
    const [row] = await this.sql<CompanySettingsRow[]>`
      SELECT * FROM company_settings WHERE tenant_id = ${this.tenantId} LIMIT 1
    `;
    return row;
  }

  async update(
    patch: Record<string, string | number | null>,
    db: Db = this.sql,
  ): Promise<CompanySettingsRow> {
    const [row] = await db<CompanySettingsRow[]>`
      UPDATE company_settings SET ${db(patch)}, updated_at = now()
      WHERE tenant_id = ${this.tenantId}
      RETURNING *
    `;
    if (!row) throw new Error("UPDATE company_settings träffade ingen rad");
    return row;
  }

  /**
   * Låser tenantens rad FOR UPDATE inne i en skapandetransaktion — så två
   * samtidiga fakturor inte kan läsa samma next_invoice_number (domain.md
   * #7, database.md #24). Skapar raden lat om den saknas. Tas så SENT som
   * möjligt i transaktionen så låset hålls kort.
   */
  async lockForUpdate(tx: TransactionSql): Promise<CompanySettingsRow> {
    await tx`
      INSERT INTO company_settings (tenant_id) VALUES (${this.tenantId})
      ON CONFLICT (tenant_id) DO NOTHING
    `;
    const [row] = await tx<CompanySettingsRow[]>`
      SELECT * FROM company_settings WHERE tenant_id = ${this.tenantId} FOR UPDATE
    `;
    if (!row) throw new Error("company_settings försvann direkt efter upsert");
    return row;
  }

  /** Räknar upp nummerserien. Anropas i samma tx som lockForUpdate. */
  async bumpInvoiceNumber(tx: TransactionSql): Promise<void> {
    await tx`
      UPDATE company_settings
      SET next_invoice_number = next_invoice_number + 1, updated_at = now()
      WHERE tenant_id = ${this.tenantId}
    `;
  }
}

// ALL SQL för customers (database.md #22). Tenant-filtrerad: varje query
// filtrerar på this.tenantId, och en träff i fel tenant blir ingen träff
// alls -> 404 i servicen (architecture.md #15).

import { TenantScopedRepository } from "@faktura/shared";
import type { Sql, TransactionSql } from "postgres";
import type { CustomerRow } from "./types";

type Db = Sql | TransactionSql;

export interface InsertCustomerData {
  customerType: "company" | "private";
  name: string;
  email: string;
  orgNumber: string | null;
  pnrEncrypted: string | null;
  pnrHmac: string | null;
  addressStreet: string | null;
  addressZip: string | null;
  addressCity: string | null;
  paymentTermsDays: number | null;
}

export class CustomerRepository extends TenantScopedRepository {
  constructor(
    private readonly sql: Sql,
    ctx: ConstructorParameters<typeof TenantScopedRepository>[0],
  ) {
    super(ctx);
  }

  async insert(db: Db, data: InsertCustomerData): Promise<CustomerRow> {
    const [row] = await db<CustomerRow[]>`
      INSERT INTO customers (
        tenant_id, customer_type, name, email, org_number,
        pnr_encrypted, pnr_hmac, address_street, address_zip, address_city,
        payment_terms_days
      ) VALUES (
        ${this.tenantId}, ${data.customerType}, ${data.name}, ${data.email}, ${data.orgNumber},
        ${data.pnrEncrypted}, ${data.pnrHmac}, ${data.addressStreet}, ${data.addressZip}, ${data.addressCity},
        ${data.paymentTermsDays}
      )
      RETURNING *
    `;
    if (!row) throw new Error("INSERT customers returnerade ingen rad");
    return row;
  }

  async list(limit: number, offset: number): Promise<CustomerRow[]> {
    return this.sql<CustomerRow[]>`
      SELECT * FROM customers WHERE tenant_id = ${this.tenantId}
      ORDER BY lower(name), id
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  async findById(id: number): Promise<CustomerRow | undefined> {
    const [row] = await this.sql<CustomerRow[]>`
      SELECT * FROM customers WHERE id = ${id} AND tenant_id = ${this.tenantId} LIMIT 1
    `;
    return row;
  }

  async update(
    id: number,
    patch: Record<string, string | number | null>,
    db: Db = this.sql,
  ): Promise<CustomerRow | undefined> {
    const [row] = await db<CustomerRow[]>`
      UPDATE customers SET ${db(patch)}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${this.tenantId}
      RETURNING *
    `;
    return row;
  }

  /** Returnerar antal raderade rader (0 = fanns inte i den här tenanten). */
  async remove(id: number, db: Db = this.sql): Promise<number> {
    const res = await db`
      DELETE FROM customers WHERE id = ${id} AND tenant_id = ${this.tenantId}
    `;
    return res.count;
  }
}

export interface CustomerCompanyMatch {
  tenantId: number;
  customerId: number;
}

/**
 * pnr_hmac -> varje (tenant, kund)-par som just nu har den här personen
 * som privatkund. Fristående funktion, INTE en metod på CustomerRepository
 * — klassens tenantId-getter kastar innan tenanten är känd (fail closed,
 * architecture.md #21), men det är precis vad det här uppslaget ska
 * avgöra. Samma avvikelse-motivering som findTenantIdByBankgiro i
 * company-settings/repository.ts.
 *
 * Till skillnad från bankgiro (globalt unikt) kan SAMMA pnr_hmac träffa
 * FLERA tenants: customers_pnr_hmac_key är unikt per (tenant_id,
 * pnr_hmac), inte globalt — en privatperson kan vara kund hos flera
 * företag (fas 12, planens Datamodell-avsnitt).
 */
export async function findCustomersByPnrHmac(
  sql: Sql,
  pnrHmac: string,
): Promise<CustomerCompanyMatch[]> {
  const rows = await sql<{ tenant_id: number; customer_id: number }[]>`
    SELECT tenant_id, id AS customer_id FROM customers
    WHERE pnr_hmac = ${pnrHmac} AND customer_type = 'private'
  `;
  return rows.map((r) => ({ tenantId: r.tenant_id, customerId: r.customer_id }));
}

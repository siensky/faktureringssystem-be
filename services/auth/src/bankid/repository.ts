import type { Sql } from "postgres";
import type { UserRow } from "../auth/types";

export function createBankIdRepository(sql: Sql) {
  return {
    async findBankIdUserByPnrHash(pnrHash: string): Promise<UserRow | undefined> {
      const [row] = await sql<UserRow[]>`
        SELECT id, tenant_id, role, auth_method, email, password_hash, pnr_hash, email_verified_at
        FROM users
        WHERE pnr_hash = ${pnrHash} AND auth_method = 'bankid'
        LIMIT 1
      `;
      return row;
    },
    async getTenantStatus(tenantId: number): Promise<string | undefined> {
      const [row] = await sql<{ status: string }[]>`
        SELECT status FROM tenants WHERE id = ${tenantId} LIMIT 1
      `;
      return row?.status;
    },
  };
}

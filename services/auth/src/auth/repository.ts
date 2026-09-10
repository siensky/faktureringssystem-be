// ALL SQL för auth-modulen (database.md #22). Ingen query någon annanstans.
//
// Notera: findUserByEmailForLogin är en MEDVETEN korsläsning utan
// tenant-filter. Vid inloggning finns ingen JWT och därmed ingen tenant
// ännu — e-posten är globalt unik (beslut fas 1) och tenant läses ur
// raden. Alla andra queries som rör en inloggad användare går via en
// tenant-scopad väg.

import type { Sql, TransactionSql } from "postgres";
import type { TenantStatus, TokenType, UserRow, UserTokenRow } from "./types";

type Db = Sql | TransactionSql;

export function createAuthRepository(sql: Sql) {
  return {
    /** Korsläsning utan tenant-filter — se filhuvudet. */
    async findUserByEmailForLogin(email: string): Promise<UserRow | undefined> {
      const [row] = await sql<UserRow[]>`
        SELECT id, tenant_id, role, auth_method, email, password_hash, pnr_hash, email_verified_at
        FROM users
        WHERE lower(email) = lower(${email}) AND auth_method = 'password'
        LIMIT 1
      `;
      return row;
    },

    async findUserByEmailAnyMethod(email: string): Promise<UserRow | undefined> {
      const [row] = await sql<UserRow[]>`
        SELECT id, tenant_id, role, auth_method, email, password_hash, pnr_hash, email_verified_at
        FROM users WHERE lower(email) = lower(${email}) LIMIT 1
      `;
      return row;
    },

    async findUserById(id: number): Promise<UserRow | undefined> {
      const [row] = await sql<UserRow[]>`
        SELECT id, tenant_id, role, auth_method, email, password_hash, pnr_hash, email_verified_at
        FROM users WHERE id = ${id} LIMIT 1
      `;
      return row;
    },

    async getTenantStatus(tenantId: number): Promise<TenantStatus | undefined> {
      const [row] = await sql<{ status: TenantStatus }[]>`
        SELECT status FROM tenants WHERE id = ${tenantId} LIMIT 1
      `;
      return row?.status;
    },

    async orgNumberExists(orgNumber: string): Promise<boolean> {
      const [row] = await sql`SELECT 1 FROM tenants WHERE org_number = ${orgNumber} LIMIT 1`;
      return row !== undefined;
    },

    /** Skapar tenant + första admin i en transaktion. Returnerar user-id. */
    async insertTenantAndAdmin(
      tx: TransactionSql,
      input: { companyName: string; orgNumber: string; email: string; passwordHash: string },
    ): Promise<{ tenantId: number; userId: number }> {
      const [tenant] = await tx<{ id: number }[]>`
        INSERT INTO tenants (name, org_number) VALUES (${input.companyName}, ${input.orgNumber})
        RETURNING id
      `;
      if (!tenant) throw new Error("INSERT tenants returnerade ingen rad");
      const [user] = await tx<{ id: number }[]>`
        INSERT INTO users (tenant_id, role, auth_method, email, password_hash)
        VALUES (${tenant.id}, 'admin', 'password', ${input.email}, ${input.passwordHash})
        RETURNING id
      `;
      if (!user) throw new Error("INSERT users returnerade ingen rad");
      return { tenantId: tenant.id, userId: user.id };
    },

    async insertToken(
      db: Db,
      input: {
        tenantId: number;
        userId: number;
        tokenType: TokenType;
        tokenHash: string;
        expiresAt: Date;
      },
    ): Promise<void> {
      await db`
        INSERT INTO user_tokens (tenant_id, user_id, token_type, token_hash, expires_at)
        VALUES (${input.tenantId}, ${input.userId}, ${input.tokenType}, ${input.tokenHash}, ${input.expiresAt})
      `;
    },

    async findToken(tokenHash: string, tokenType: TokenType): Promise<UserTokenRow | undefined> {
      const [row] = await sql<UserTokenRow[]>`
        SELECT id, tenant_id, user_id, token_type, token_hash, expires_at, used_at
        FROM user_tokens
        WHERE token_hash = ${tokenHash} AND token_type = ${tokenType}
        LIMIT 1
      `;
      return row;
    },

    async markTokenUsed(db: Db, id: string): Promise<void> {
      await db`UPDATE user_tokens SET used_at = now() WHERE id = ${id} AND used_at IS NULL`;
    },

    /** Ogiltigförklarar alla oanvända tokens av en typ för en användare. */
    async revokeTokens(db: Db, userId: number, tokenType: TokenType): Promise<void> {
      await db`
        UPDATE user_tokens SET used_at = now()
        WHERE user_id = ${userId} AND token_type = ${tokenType} AND used_at IS NULL
      `;
    },

    async setEmailVerified(db: Db, userId: number): Promise<void> {
      await db`UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = ${userId}`;
    },

    async updatePassword(db: Db, userId: number, passwordHash: string): Promise<void> {
      await db`
        UPDATE users SET password_hash = ${passwordHash}, updated_at = now() WHERE id = ${userId}
      `;
    },

    /** Endast för tester/verifiering. */
    async countTenants(): Promise<number> {
      const [row] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM tenants`;
      return Number(row?.count ?? 0);
    },
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;

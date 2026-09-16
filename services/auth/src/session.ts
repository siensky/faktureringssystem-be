// Utfärdar en session (access-token + lagrat refresh-token) för en
// autentiserad användare. Delas av lösenordsinloggning och BankID —
// TTL:er och hashning bor på ETT ställe.

import { USER_TOKEN, signAccessToken } from "@faktura/shared";
import type { Sql } from "postgres";
import type { config as Config } from "./config";
import { generateToken, hashToken } from "./passwords";

export interface SessionUser {
  id: number;
  tenant_id: number;
  role: "admin" | "customer";
  /** Bara satt för role: "customer" (domain.md #33). */
  customer_id?: number | null;
}

export function createSessionIssuer(deps: { sql: Sql; config: typeof Config }) {
  return {
    async issue(user: SessionUser) {
      const accessToken = await signAccessToken(
        {
          userId: user.id,
          tenantId: user.tenant_id,
          role: user.role,
          ...(user.customer_id != null ? { customerId: user.customer_id } : {}),
        },
        deps.config.jwtUserSecret,
      );
      const refreshToken = generateToken();
      await deps.sql`
        INSERT INTO user_tokens (tenant_id, user_id, token_type, token_hash, expires_at)
        VALUES (
          ${user.tenant_id}, ${user.id}, 'refresh',
          ${hashToken(refreshToken, deps.config.tokenPepper)},
          ${new Date(Date.now() + deps.config.refreshTtlSeconds * 1000)}
        )
      `;
      return {
        accessToken,
        refreshToken,
        expiresIn: USER_TOKEN.ttlSeconds,
        tokenType: "Bearer" as const,
      };
    },
  };
}

export type SessionIssuer = ReturnType<typeof createSessionIssuer>;

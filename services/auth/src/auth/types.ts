// Interna typer för auth-modulen. Databasrader är snake_case (postgres.js
// returnerar dem så); mappers är enda stället de möts av camelCase-koden
// (code-style.md #6).

export type UserRole = "admin" | "customer";
export type AuthMethod = "password" | "bankid";
export type TokenType = "refresh" | "email_verification" | "password_reset";
export type TenantStatus = "active" | "suspended";

export interface UserRow {
  id: number;
  tenant_id: number;
  role: UserRole;
  auth_method: AuthMethod;
  email: string | null;
  password_hash: string | null;
  pnr_hash: string | null;
  email_verified_at: Date | null;
}

export interface UserTokenRow {
  id: string;
  tenant_id: number;
  user_id: number;
  token_type: TokenType;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Sekunder tills access-token går ut. */
  expiresIn: number;
}

export interface RegisterInput {
  companyName: string;
  orgNumber: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

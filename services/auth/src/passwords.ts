// Lösenordshashning och token-hashning.
//
// Lösenord: Bun.password (argon2id) — inbyggt i runtimen, noll beroenden
// (code-style.md #20, #28: tråkiga lösningen). Bun.password.verify är
// konstant-tid.
//
// Refresh- och engångstokens är hög-entropi slumpvärden, inte lösenord —
// de behöver ingen argon2. De hashas med HMAC-SHA256 + en serverside-
// peppar (samma mönster som pnr_hash, domain.md #20): en läckt
// user_tokens-tabell ensam kan då varken verifiera eller förfalska tokens.

import { randomBytes } from "node:crypto";
import { hmacField } from "@faktura/shared";

export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: "argon2id" });
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash);
}

/** Slumpar ett ogissningsbart token (refresh eller engångslänk). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Deterministisk hash för uppslag i user_tokens. `pepper` = AUTH_TOKEN_PEPPER. */
export function hashToken(token: string, pepper: string): string {
  return hmacField(token, pepper);
}

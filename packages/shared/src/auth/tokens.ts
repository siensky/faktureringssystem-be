// Access-token: signering och verifiering. HS256 med en hemlighet PER
// token-klass (planens Säkerhet-avsnitt): JWT_USER_SECRET för användar-
// tokens, JWT_SERVICE_SECRET för tjänste-tokens (fas 2). Algoritmen pinnas
// explicit vid verifiering (code-style.md #25) — `alg` i token-headern
// litas aldrig på.

import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { Unauthorized } from "../errors";

export const USER_TOKEN = {
  issuer: "faktura-auth",
  audience: "api",
  type: "access",
  ttlSeconds: 15 * 60,
} as const;

export interface AccessTokenClaims {
  userId: number;
  tenantId: number;
  role: "admin" | "customer";
  /** Bara satt (och obligatoriskt) för role: "customer" — se domain.md #32,
   *  Åtkomstkontroll i två lager: rätt tenant OCH rätt kund. */
  customerId?: number;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(claims: AccessTokenClaims, secret: string): Promise<string> {
  return new SignJWT({
    tenantId: claims.tenantId,
    role: claims.role,
    ...(claims.customerId !== undefined ? { customerId: claims.customerId } : {}),
    token_type: USER_TOKEN.type,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setSubject(String(claims.userId))
    .setIssuer(USER_TOKEN.issuer)
    .setAudience(USER_TOKEN.audience)
    .setIssuedAt()
    .setExpirationTime(`${USER_TOKEN.ttlSeconds}s`)
    .sign(key(secret));
}

/**
 * Verifierar ett access-token. Kastar Unauthorized (401) vid varje fel —
 * fel signatur, utgången, fel issuer/audience, eller fel token_type
 * (t.ex. ett tjänste-token som råkat hamna på en användar-endpoint).
 */
export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenClaims> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
      issuer: USER_TOKEN.issuer,
      audience: USER_TOKEN.audience,
    }));
  } catch {
    throw new Unauthorized("Ogiltigt eller utgånget token");
  }

  if (payload.token_type !== USER_TOKEN.type) {
    throw new Unauthorized("Fel token-typ");
  }

  const userId = Number(payload.sub);
  const tenantId = Number(payload.tenantId);
  const role = payload.role;
  if (
    !Number.isInteger(userId) ||
    !Number.isInteger(tenantId) ||
    (role !== "admin" && role !== "customer")
  ) {
    throw new Unauthorized("Token saknar obligatoriska claims");
  }

  if (role === "customer") {
    const customerId = Number(payload.customerId);
    if (!Number.isInteger(customerId)) {
      throw new Unauthorized("Token saknar obligatoriska claims");
    }
    return { userId, tenantId, role, customerId };
  }

  return { userId, tenantId, role };
}

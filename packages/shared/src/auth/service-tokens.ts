// Tjänste-token (M2M): signering och verifiering. Egen hemlighet
// (JWT_SERVICE_SECRET), egen `aud` och `token_type` — ett tjänste-token
// och ett användar-token får ALDRIG kunna förväxlas (architecture.md #16,
// #21). Ett tjänste-token saknar `tenantId` helt; en tjänst hävdar tenant
// via X-Tenant-Id (#17).

import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { Forbidden, Unauthorized } from "../errors";

export const SERVICE_TOKEN = {
  issuer: "faktura-auth",
  audience: "internal",
  type: "service",
  ttlSeconds: 5 * 60,
} as const;

export interface ServiceTokenClaims {
  /** client_id — identifierar den anropande tjänsten. */
  clientId: string;
  /** Beviljade scopes, mellanslagsseparerade (OAuth2-konvention). */
  scope: string;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signServiceToken(
  claims: ServiceTokenClaims,
  secret: string,
): Promise<string> {
  return new SignJWT({ scope: claims.scope, token_type: SERVICE_TOKEN.type })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setSubject(claims.clientId)
    .setIssuer(SERVICE_TOKEN.issuer)
    .setAudience(SERVICE_TOKEN.audience)
    .setIssuedAt()
    .setExpirationTime(`${SERVICE_TOKEN.ttlSeconds}s`)
    .sign(key(secret));
}

export interface VerifiedServiceToken {
  clientId: string;
  scopes: string[];
}

/**
 * Verifierar ett tjänste-token. Kastar Unauthorized (401) vid signatur-,
 * utgångs-, issuer-, audience- eller token_type-fel — inklusive ett
 * användar-token som råkat hamna på en requireService()-endpoint.
 */
export async function verifyServiceToken(
  token: string,
  secret: string,
): Promise<VerifiedServiceToken> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
      issuer: SERVICE_TOKEN.issuer,
      audience: SERVICE_TOKEN.audience,
    }));
  } catch {
    throw new Unauthorized("Ogiltigt eller utgånget tjänste-token");
  }

  if (payload.token_type !== SERVICE_TOKEN.type || typeof payload.sub !== "string") {
    throw new Unauthorized("Fel token-typ");
  }

  const scopes = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
  return { clientId: payload.sub, scopes };
}

/** Kastar Forbidden (403) om `required` inte finns bland `granted`. */
export function assertScope(granted: string[], required: string): void {
  if (!granted.includes(required)) {
    throw new Forbidden(`Saknar scope: ${required}`);
  }
}

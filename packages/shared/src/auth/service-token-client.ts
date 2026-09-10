// Klient-helper: hämtar ett tjänste-token från auth (OAuth2
// client_credentials) och cachar det i Redis tills strax före utgång.
// Byggs i fas 2, används av billing/payments från fas 3.

import type Redis from "ioredis";

const CACHE_PREFIX = "svc-token:";
const REFRESH_MARGIN_SECONDS = 30;

export interface ServiceTokenClientOptions {
  authBaseUrl: string;
  clientId: string;
  clientSecret: string;
  redis: Redis;
  scopes: string[];
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Returnerar ett giltigt tjänste-token, från cachen om möjligt annars
 * hämtat på nytt. Cache-nyckeln inkluderar de begärda scopen så olika
 * scope-uppsättningar inte trampar på varandra.
 */
export async function getServiceToken(opts: ServiceTokenClientOptions): Promise<string> {
  const scopeKey = [...opts.scopes].sort().join(" ");
  const cacheKey = `${CACHE_PREFIX}${opts.clientId}:${scopeKey}`;

  const cached = await opts.redis.get(cacheKey);
  if (cached) return cached;

  const res = await fetch(`${opts.authBaseUrl}/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      scope: scopeKey,
    }),
  });
  if (!res.ok) {
    throw new Error(`Kunde inte hämta tjänste-token: ${res.status}`);
  }
  const body = (await res.json()) as TokenResponse;
  const ttl = Math.max(body.expires_in - REFRESH_MARGIN_SECONDS, 1);
  await opts.redis.set(cacheKey, body.access_token, "EX", ttl);
  return body.access_token;
}

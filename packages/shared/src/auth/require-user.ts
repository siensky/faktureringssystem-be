// requireUser(): Fastify preHandler som verifierar ett access-token och
// bygger en RequestContext. En av de TVÅ separata verifieringsfunktionerna
// (architecture.md #16) — requireService(scope) är den andra (fas 2).
// Ingen endpoint anropar en generisk "verifiera token".
//
// X-Tenant-Id IGNORERAS helt här (architecture.md #17): en slutanvändare
// får aldrig hävda vilken tenant den agerar i. Tenant kommer enbart ur
// token-claimen.

import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Unauthorized } from "../errors";
import type { RequestContext } from "../repository";
import { verifyAccessToken } from "./tokens";

declare module "fastify" {
  interface FastifyRequest {
    ctx?: RequestContext;
  }
}

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new Unauthorized("Authorization: Bearer-token saknas");
  }
  return header.slice("Bearer ".length).trim();
}

export function createRequireUser(userSecret: string) {
  return async function requireUser(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const claims = await verifyAccessToken(bearer(request), userSecret);
    const correlationId =
      (request.headers["x-correlation-id"] as string | undefined) ?? randomUUID();

    request.ctx = {
      userId: claims.userId,
      tenantId: claims.tenantId,
      role: claims.role,
      correlationId,
    };
  };
}

/** Hämtar den satta kontexten, kastar om preHandlern inte körts. */
export function contextOf(request: FastifyRequest): RequestContext {
  if (!request.ctx) {
    throw new Unauthorized("Ingen autentiserad kontext på requesten");
  }
  return request.ctx;
}

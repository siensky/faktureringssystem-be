// Fas 2-fixturer för att göra fasens "Klart när" testbart innan det finns
// riktiga skyddade endpoints:
//   GET /auth/me                 (requireUser)    — bevisar att X-Tenant-Id
//                                                   ignoreras på användar-endpoints
//   GET /internal/auth/tenant-echo (requireService) — bevisar att ett S2S-
//                                                   anrop utan X-Tenant-Id kastar
//                                                   i stället för att ge data
// Båda tas bort när riktiga endpoints finns (fas 3), precis som
// ping-debug-endpointen från fas 0.

import { TenantScopedRepository, contextOf, serviceContextOf } from "@faktura/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

// En minimal tenant-scopad "repository" — anropar this.tenantId, som
// kastar om kontexten saknar tenant (architecture.md #20).
class TenantEcho extends TenantScopedRepository {
  echo(): number {
    return this.tenantId;
  }
}

export function registerInternalFixtures(
  app: FastifyInstance,
  deps: {
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireService: (scope: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  },
): void {
  app.get("/auth/me", { preHandler: deps.requireUser }, async (req) => {
    const ctx = contextOf(req);
    return { userId: ctx.userId, tenantId: ctx.tenantId, role: ctx.role };
  });

  app.get(
    "/internal/auth/tenant-echo",
    { preHandler: deps.requireService("auth:tenant:read") },
    async (req) => {
      const svc = serviceContextOf(req);
      const echo = new TenantEcho({
        userId: 0,
        tenantId: svc.tenantId as number,
        role: "admin",
        correlationId: svc.correlationId,
      });
      return { tenantId: echo.echo() };
    },
  );
}

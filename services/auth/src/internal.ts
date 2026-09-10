// Fas 2-fixturer för att göra fasens "Klart när" testbart innan det finns
// riktiga skyddade endpoints:
//   GET /auth/me                    (requireUser)    — bevisar att X-Tenant-Id
//                                                      ignoreras på användar-endpoints
//   GET /internal/auth/tenant-echo  (requireService) — bevisar att en S2S-
//                                                      handler som kräver tenant
//                                                      avvisar utan X-Tenant-Id
//                                                      (medvetet 400, inte 500),
//                                                      och att en avstängd tenant
//                                                      i headern ger 403
// Scopet är `internal:fixture` — INTE `auth:tenant:read`, som planen
// medvetet strök som scope. Båda endpoints tas bort när riktiga endpoints
// finns (fas 3), precis som ping-debug-endpointen från fas 0.

import {
  TenantScopedRepository,
  contextOf,
  requireTenantHeader,
  serviceContextOf,
} from "@faktura/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export const FIXTURE_SCOPE = "internal:fixture";

// En minimal tenant-scopad "repository" — sista skyddsnätet: this.tenantId
// kastar om kontexten saknar tenant (architecture.md #21).
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
    { preHandler: deps.requireService(FIXTURE_SCOPE) },
    async (req) => {
      // Medvetet fail-closed: 400 om X-Tenant-Id saknas, inte ett 500 från
      // repository-gettern (som är sista skyddsnätet, inte förstahandsvalet).
      const tenantId = requireTenantHeader(req);
      const svc = serviceContextOf(req);
      const echo = new TenantEcho({
        userId: 0,
        tenantId,
        role: "admin",
        correlationId: svc.correlationId,
      });
      return { tenantId: echo.echo() };
    },
  );
}

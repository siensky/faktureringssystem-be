// Fas 2-fixtur för att göra fasens "Klart när" testbart innan det finns en
// riktig S2S-endpoint:
//   GET /internal/auth/tenant-echo  (requireService) — bevisar att en S2S-
//                                                      handler som kräver tenant
//                                                      avvisar utan X-Tenant-Id
//                                                      (medvetet 400, inte 500),
//                                                      och att en avstängd tenant
//                                                      i headern ger 403
// Scopet är `internal:fixture` — INTE `auth:tenant:read`, som planen
// medvetet strök som scope. Tas bort när en riktig S2S-endpoint finns,
// precis som ping-debug-endpointen från fas 0.
//
// Den tidigare GET /auth/me-fixturen här (samma användning: bevisa att
// X-Tenant-Id ignoreras på användar-endpoints) ersattes i fas 8 av den
// riktiga GET /auth/me i auth/routes.ts — samma path, samma requireUser,
// och samma fält (userId/tenantId/role) i svaret, plus tenantName/email.

import { TenantScopedRepository, requireTenantHeader, serviceContextOf } from "@faktura/shared";
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
    requireService: (scope: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  },
): void {
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

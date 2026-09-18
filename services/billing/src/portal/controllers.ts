import { contextOf, requireTenantHeader, serviceContextOf } from "@faktura/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PortalService } from "./services";

type ListQuery = { limit?: number; offset?: number };

export function createPortalControllers(service: PortalService) {
  return {
    async list(request: FastifyRequest<{ Querystring: ListQuery }>, reply: FastifyReply) {
      return reply.send(await service.list(contextOf(request), request.query));
    },

    async get(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
      return reply.send(await service.get(contextOf(request), request.params.id));
    },

    async getPdfUrl(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
      return reply.send(await service.getPdfUrl(contextOf(request), request.params.id));
    },

    async pay(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
      const result = await service.pay(contextOf(request), request.params.id);
      return reply.status(201).send(result);
    },

    async accountSummary(request: FastifyRequest, reply: FastifyReply) {
      return reply.send(await service.accountSummary(contextOf(request)));
    },

    async listTemplates(request: FastifyRequest, reply: FastifyReply) {
      return reply.send(await service.listTemplates(contextOf(request)));
    },

    /**
     * S2S (fas 12) — auth har redan slagit upp (tenantId, customerId) via
     * user_company_links, X-Tenant-Id KRÄVS här (till skillnad från
     * by-pnr-hmac i customers-modulen: tenanten är redan känd). Bygger en
     * syntetisk kontext och återanvänder den OFÖRÄNDRADE
     * portalService.accountSummary — PortalRepository/PortalService rörs
     * inte alls.
     */
    async accountSummaryInternal(
      request: FastifyRequest<{ Querystring: { customerId: number } }>,
      reply: FastifyReply,
    ) {
      const tenantId = requireTenantHeader(request);
      const svc = serviceContextOf(request);
      return reply.send(
        await service.accountSummary({
          userId: 0,
          tenantId,
          role: "customer",
          customerId: request.query.customerId,
          correlationId: svc.correlationId,
        }),
      );
    },
  };
}

// Plockar isär requesten, anropar servicen, formar svaret (code-style.md #2).

import { contextOf, requireTenantHeader, serviceContextOf } from "@faktura/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { correlationIdOf } from "../guards";
import type { CompanySettingsService } from "./services";
import type { CompanySettingsPatch } from "./types";

export function createCompanySettingsControllers(service: CompanySettingsService) {
  return {
    async get(request: FastifyRequest, reply: FastifyReply) {
      return reply.send(await service.getForAdmin(contextOf(request)));
    },

    async update(request: FastifyRequest<{ Body: CompanySettingsPatch }>, reply: FastifyReply) {
      return reply.send(await service.update(contextOf(request), request.body));
    },

    /** S2S — bygger en syntetisk kontext ur X-Tenant-Id. */
    async getInternal(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = requireTenantHeader(request);
      const svc = serviceContextOf(request);
      return reply.send(
        await service.getForService({
          userId: 0,
          tenantId,
          role: "admin",
          correlationId: svc.correlationId,
        }),
      );
    },
  };
}

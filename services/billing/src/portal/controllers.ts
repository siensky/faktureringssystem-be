import { contextOf } from "@faktura/shared";
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

    async accountSummary(request: FastifyRequest, reply: FastifyReply) {
      return reply.send(await service.accountSummary(contextOf(request)));
    },
  };
}

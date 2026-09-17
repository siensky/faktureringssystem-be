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

    async pay(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
      const result = await service.pay(contextOf(request), request.params.id);
      return reply.status(201).send(result);
    },

    async accountSummary(request: FastifyRequest, reply: FastifyReply) {
      return reply.send(await service.accountSummary(contextOf(request)));
    },
  };
}

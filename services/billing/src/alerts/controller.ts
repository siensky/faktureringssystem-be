import type { FastifyReply, FastifyRequest } from "fastify";
import type { AlertsService } from "./service";

export function createAlertsController(service: AlertsService) {
  return {
    async get(_request: FastifyRequest, reply: FastifyReply) {
      return reply.send(await service.getAlerts());
    },
  };
}

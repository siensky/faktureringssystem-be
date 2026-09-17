import type { FastifyReply, FastifyRequest } from "fastify";
import type { BankIdService } from "./services";

export function createBankIdControllers(service: BankIdService) {
  return {
    async init(req: FastifyRequest<{ Body: { personalNumber?: string } }>, reply: FastifyReply) {
      return reply.send(await service.init(req.body.personalNumber, req.ip));
    },
    async collect(req: FastifyRequest<{ Body: { orderRef: string } }>, reply: FastifyReply) {
      return reply.send(await service.collect(req.body.orderRef));
    },
  };
}

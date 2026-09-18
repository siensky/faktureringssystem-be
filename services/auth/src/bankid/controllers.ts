import { contextOf, resolveCorrelationId } from "@faktura/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { BankIdService } from "./services";

export function createBankIdControllers(service: BankIdService) {
  return {
    async init(req: FastifyRequest<{ Body: { personalNumber?: string } }>, reply: FastifyReply) {
      return reply.send(await service.init(req.body.personalNumber, req.ip));
    },
    async collect(req: FastifyRequest<{ Body: { orderRef: string } }>, reply: FastifyReply) {
      const correlationId = resolveCorrelationId(req.headers["x-correlation-id"]);
      return reply.send(await service.collect(req.body.orderRef, correlationId));
    },
    /** Kräver requireUser — bara en redan inloggad BankID-kundidentitet kan byta aktivt företag. */
    async switchCompany(req: FastifyRequest<{ Body: { tenantId: number } }>, reply: FastifyReply) {
      const ctx = contextOf(req);
      return reply.send(await service.switchCompany(ctx.userId, req.body.tenantId));
    },

    /** Kräver requireUser. Tom lista (inte fel) för en lösenordskund. */
    async overview(req: FastifyRequest, reply: FastifyReply) {
      const ctx = contextOf(req);
      const correlationId = resolveCorrelationId(req.headers["x-correlation-id"]);
      return reply.send(await service.overview(ctx.userId, correlationId));
    },
  };
}

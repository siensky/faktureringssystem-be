import { contextOf } from "@faktura/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { idempotencyKeyOf } from "../guards";
import { withIdempotency } from "../idempotency";
import type { AdminPaymentsService } from "./services";
import type { IgnoreBody, MatchBody } from "./types";

export function createAdminPaymentsControllers(service: AdminPaymentsService, sql: Sql) {
  return {
    async listUnmatched(request: FastifyRequest, reply: FastifyReply) {
      return reply.send({ items: await service.listUnmatched(contextOf(request)) });
    },

    async match(
      request: FastifyRequest<{ Params: { id: number }; Body: MatchBody }>,
      reply: FastifyReply,
    ) {
      const ctx = contextOf(request);
      const key = idempotencyKeyOf(request);
      const outcome = await withIdempotency({
        sql,
        tenantId: ctx.tenantId,
        key,
        endpoint: "POST /admin/payments/:id/match",
        requestBody: { id: request.params.id, invoiceId: request.body.invoiceId },
        run: (tx) => service.matchInTx(ctx, tx, request.params.id, request.body.invoiceId),
      });
      return reply.status(outcome.status).send(outcome.body);
    },

    async ignore(
      request: FastifyRequest<{ Params: { id: number }; Body: IgnoreBody }>,
      reply: FastifyReply,
    ) {
      const ctx = contextOf(request);
      const key = idempotencyKeyOf(request);
      const outcome = await withIdempotency({
        sql,
        tenantId: ctx.tenantId,
        key,
        endpoint: "POST /admin/payments/:id/ignore",
        requestBody: { id: request.params.id, reason: request.body.reason },
        run: (tx) => service.ignoreInTx(ctx, tx, request.params.id, request.body.reason),
      });
      return reply.status(outcome.status).send(outcome.body);
    },
  };
}

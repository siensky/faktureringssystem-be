import { contextOf, requireTenantHeader, serviceContextOf } from "@faktura/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { idempotencyKeyOf } from "../guards";
import { withIdempotency } from "../idempotency";
import type { CustomerService } from "./services";
import type { CreateCustomerInput, UpdateCustomerInput } from "./types";

export function createCustomerControllers(service: CustomerService, sql: Sql) {
  return {
    async create(request: FastifyRequest<{ Body: CreateCustomerInput }>, reply: FastifyReply) {
      const ctx = contextOf(request);
      const key = idempotencyKeyOf(request);
      const outcome = await withIdempotency({
        sql,
        tenantId: ctx.tenantId,
        key,
        endpoint: "POST /admin/customers",
        requestBody: request.body,
        run: (tx) => service.createInTx(ctx, tx, request.body),
      });
      return reply.status(outcome.status).send(outcome.body);
    },

    async list(
      request: FastifyRequest<{ Querystring: { limit?: number; offset?: number } }>,
      reply: FastifyReply,
    ) {
      return reply.send(await service.list(contextOf(request), request.query));
    },

    async get(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
      return reply.send(await service.get(contextOf(request), request.params.id));
    },

    async update(
      request: FastifyRequest<{ Params: { id: number }; Body: UpdateCustomerInput }>,
      reply: FastifyReply,
    ) {
      return reply.send(await service.update(contextOf(request), request.params.id, request.body));
    },

    async remove(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
      return reply.send(await service.remove(contextOf(request), request.params.id));
    },

    async getInternal(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
      const tenantId = requireTenantHeader(request);
      const svc = serviceContextOf(request);
      return reply.send(
        await service.getForService(
          { userId: 0, tenantId, role: "admin", correlationId: svc.correlationId },
          request.params.id,
        ),
      );
    },

    /**
     * S2S — till skillnad från getInternal anropas INTE requireTenantHeader
     * här: tenanten är okänd, det är precis vad uppslaget ska avgöra
     * (fas 12).
     */
    async byPnrHmac(
      request: FastifyRequest<{ Querystring: { pnrHmac: string } }>,
      reply: FastifyReply,
    ) {
      const matches = await service.lookupByPnrHmac(request.query.pnrHmac);
      return reply.send({ matches });
    },
  };
}

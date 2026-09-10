import { contextOf, requireTenantHeader, serviceContextOf } from "@faktura/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { idempotencyKeyOf } from "../guards";
import { withIdempotency } from "../idempotency";
import type { InvoiceService } from "./services";
import type { CreateInvoiceInput, InvoiceStatus, UpdateInvoiceInput } from "./types";

export function createInvoiceControllers(service: InvoiceService, sql: Sql) {
  return {
    async create(request: FastifyRequest<{ Body: CreateInvoiceInput }>, reply: FastifyReply) {
      const ctx = contextOf(request);
      const key = idempotencyKeyOf(request);
      const outcome = await withIdempotency({
        sql,
        tenantId: ctx.tenantId,
        key,
        endpoint: "POST /admin/invoices",
        requestBody: request.body,
        run: (tx) => service.createInTx(ctx, tx, request.body),
      });
      return reply.status(outcome.status).send(outcome.body);
    },

    async list(
      request: FastifyRequest<{ Querystring: { status?: InvoiceStatus } }>,
      reply: FastifyReply,
    ) {
      return reply.send(await service.list(contextOf(request), request.query.status));
    },

    async get(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
      return reply.send(await service.get(contextOf(request), request.params.id));
    },

    async update(
      request: FastifyRequest<{ Params: { id: number }; Body: UpdateInvoiceInput }>,
      reply: FastifyReply,
    ) {
      return reply.send(await service.update(contextOf(request), request.params.id, request.body));
    },

    async remove(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
      return reply.send(await service.remove(contextOf(request), request.params.id));
    },

    async send(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
      const ctx = contextOf(request);
      const key = idempotencyKeyOf(request);
      const outcome = await withIdempotency({
        sql,
        tenantId: ctx.tenantId,
        key,
        endpoint: "POST /admin/invoices/:id/send",
        requestBody: { invoiceId: request.params.id },
        run: (tx) => service.sendInTx(ctx, tx, request.params.id),
      });
      return reply.status(outcome.status).send(outcome.body);
    },

    async credit(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
      const ctx = contextOf(request);
      const key = idempotencyKeyOf(request);
      const outcome = await withIdempotency({
        sql,
        tenantId: ctx.tenantId,
        key,
        endpoint: "POST /admin/invoices/:id/credit",
        requestBody: { invoiceId: request.params.id },
        run: (tx) => service.creditInTx(ctx, tx, request.params.id),
      });
      return reply.status(outcome.status).send(outcome.body);
    },

    async getSnapshot(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
      const tenantId = requireTenantHeader(request);
      const svc = serviceContextOf(request);
      return reply.send(
        await service.getSnapshot(
          { userId: 0, tenantId, role: "admin", correlationId: svc.correlationId },
          request.params.id,
        ),
      );
    },

    async byOcr(request: FastifyRequest<{ Querystring: { ocr: string } }>, reply: FastifyReply) {
      const tenantId = requireTenantHeader(request);
      const svc = serviceContextOf(request);
      return reply.send(
        await service.resolveByOcr(
          { userId: 0, tenantId, role: "admin", correlationId: svc.correlationId },
          request.query.ocr,
        ),
      );
    },
  };
}

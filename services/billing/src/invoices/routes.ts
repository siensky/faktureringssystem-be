import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { createInvoiceControllers } from "./controllers";
import * as schema from "./schema";
import type { InvoiceService } from "./services";
import type {
  CreateInvoiceInput,
  CreateInvoiceTemplateInput,
  DeliveryStatus,
  InvoiceStatus,
  UpdateInvoiceInput,
  UpdateInvoiceTemplateInput,
} from "./types";

type ListQuery = { status?: InvoiceStatus; limit?: number; offset?: number };
type ListDeliveriesQuery = { status?: DeliveryStatus; limit?: number; offset?: number };

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerInvoiceRoutes(
  app: FastifyInstance,
  service: InvoiceService,
  sql: Sql,
  deps: {
    userChain: PreHandler[];
    requireService: (scope: string) => PreHandler;
  },
): void {
  const c = createInvoiceControllers(service, sql);
  const u = { preHandler: deps.userChain };

  app.post<{ Body: CreateInvoiceInput }>(
    "/admin/invoices",
    { ...u, schema: { body: schema.createInvoiceBody } },
    c.create,
  );
  app.get<{ Querystring: ListQuery }>(
    "/admin/invoices",
    { ...u, schema: { querystring: schema.listInvoicesQuery } },
    c.list,
  );
  app.get<{ Params: { id: number } }>(
    "/admin/invoices/:id",
    { ...u, schema: { params: schema.invoiceIdParams } },
    c.get,
  );
  app.get<{ Querystring: ListDeliveriesQuery }>(
    "/admin/deliveries",
    { ...u, schema: { querystring: schema.listDeliveriesQuery } },
    c.listDeliveries,
  );
  app.put<{ Params: { id: number }; Body: UpdateInvoiceInput }>(
    "/admin/invoices/:id",
    { ...u, schema: { params: schema.invoiceIdParams, body: schema.updateInvoiceBody } },
    c.update,
  );
  app.delete<{ Params: { id: number } }>(
    "/admin/invoices/:id",
    { ...u, schema: { params: schema.invoiceIdParams } },
    c.remove,
  );
  app.post<{ Params: { id: number } }>(
    "/admin/invoices/:id/send",
    { ...u, schema: { params: schema.invoiceIdParams } },
    c.send,
  );
  app.post<{ Params: { id: number } }>(
    "/admin/invoices/:id/credit",
    { ...u, schema: { params: schema.invoiceIdParams } },
    c.credit,
  );

  // Fas 13: återkommande fakturor. Genereringen (cronjobbet i automation/)
  // fanns redan sedan fas 6 — det här är bara CRUD:et som saknades för att
  // skapa en mall i första läget.
  app.post<{ Body: CreateInvoiceTemplateInput }>(
    "/admin/invoice-templates",
    { ...u, schema: { body: schema.createInvoiceTemplateBody } },
    c.createTemplate,
  );
  app.get("/admin/invoice-templates", u, c.listTemplates);
  app.get<{ Params: { id: number } }>(
    "/admin/invoice-templates/:id",
    { ...u, schema: { params: schema.invoiceIdParams } },
    c.getTemplate,
  );
  app.put<{ Params: { id: number }; Body: UpdateInvoiceTemplateInput }>(
    "/admin/invoice-templates/:id",
    { ...u, schema: { params: schema.invoiceIdParams, body: schema.updateInvoiceTemplateBody } },
    c.updateTemplate,
  );
  app.delete<{ Params: { id: number } }>(
    "/admin/invoice-templates/:id",
    { ...u, schema: { params: schema.invoiceIdParams } },
    c.removeTemplate,
  );

  app.get<{ Params: { id: number } }>(
    "/internal/invoices/:id/snapshot",
    {
      preHandler: deps.requireService("billing:invoice:read"),
      schema: { params: schema.invoiceIdParams },
    },
    c.getSnapshot,
  );
  app.get<{ Querystring: { ocr: string } }>(
    "/internal/invoices/by-ocr",
    {
      preHandler: deps.requireService("billing:invoice:read"),
      schema: { querystring: schema.byOcrQuery },
    },
    c.byOcr,
  );
  app.get<{ Params: { id: number } }>(
    "/internal/invoices/:id/current",
    {
      preHandler: deps.requireService("billing:invoice:read"),
      schema: { params: schema.invoiceIdParams },
    },
    c.current,
  );
}

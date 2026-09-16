import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createPortalControllers } from "./controllers";
import * as schema from "./schema";
import type { PortalService } from "./services";

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
type ListQuery = { limit?: number; offset?: number };

export function registerPortalRoutes(
  app: FastifyInstance,
  service: PortalService,
  deps: { customerChain: PreHandler[] },
): void {
  const c = createPortalControllers(service);
  const u = { preHandler: deps.customerChain };

  app.get<{ Querystring: ListQuery }>(
    "/portal/invoices",
    { ...u, schema: { querystring: schema.listInvoicesQuery } },
    c.list,
  );
  app.get<{ Params: { id: number } }>(
    "/portal/invoices/:id",
    { ...u, schema: { params: schema.invoiceIdParams } },
    c.get,
  );
  app.get<{ Params: { id: number } }>(
    "/portal/invoices/:id/pdf",
    { ...u, schema: { params: schema.invoiceIdParams } },
    c.getPdfUrl,
  );
  app.get("/portal/account-summary", u, c.accountSummary);
}

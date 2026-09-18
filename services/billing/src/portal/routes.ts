import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createPortalControllers } from "./controllers";
import * as schema from "./schema";
import type { PortalService } from "./services";

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
type ListQuery = { limit?: number; offset?: number };

export function registerPortalRoutes(
  app: FastifyInstance,
  service: PortalService,
  deps: { customerChain: PreHandler[]; requireService: (scope: string) => PreHandler },
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
  app.post<{ Params: { id: number } }>(
    "/portal/invoices/:id/pay",
    { ...u, schema: { params: schema.invoiceIdParams } },
    c.pay,
  );

  // Fas 12: auth ropar denna för att bygga företagsöversikten, en gång per
  // länkat företag (aldrig en fråga som själv korsar tenant_id).
  app.get<{ Querystring: { customerId: number } }>(
    "/internal/portal/account-summary",
    {
      preHandler: deps.requireService("billing:portal:read"),
      schema: { querystring: schema.accountSummaryInternalQuery },
    },
    c.accountSummaryInternal,
  );
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { createAdminPaymentsControllers } from "./controllers";
import * as schema from "./schema";
import type { AdminPaymentsService } from "./services";
import type { IgnoreBody, MatchBody } from "./types";

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerAdminPaymentsRoutes(
  app: FastifyInstance,
  service: AdminPaymentsService,
  sql: Sql,
  deps: { userChain: PreHandler[] },
): void {
  const c = createAdminPaymentsControllers(service, sql);
  const u = { preHandler: deps.userChain };

  app.get("/admin/payments/unmatched", u, c.listUnmatched);

  app.post<{ Params: { id: number }; Body: MatchBody }>(
    "/admin/payments/:id/match",
    { ...u, schema: { params: schema.transactionIdParams, body: schema.matchBody } },
    c.match,
  );

  app.post<{ Params: { id: number }; Body: IgnoreBody }>(
    "/admin/payments/:id/ignore",
    { ...u, schema: { params: schema.transactionIdParams, body: schema.ignoreBody } },
    c.ignore,
  );
}

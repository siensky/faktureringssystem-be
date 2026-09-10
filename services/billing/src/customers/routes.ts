import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { createCustomerControllers } from "./controllers";
import * as schema from "./schema";
import type { CustomerService } from "./services";
import type { CreateCustomerInput, UpdateCustomerInput } from "./types";

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerCustomerRoutes(
  app: FastifyInstance,
  service: CustomerService,
  sql: Sql,
  deps: {
    userChain: PreHandler[];
    requireService: (scope: string) => PreHandler;
  },
): void {
  const c = createCustomerControllers(service, sql);

  app.post<{ Body: CreateCustomerInput }>(
    "/admin/customers",
    { preHandler: deps.userChain, schema: { body: schema.createCustomerBody } },
    c.create,
  );
  app.get("/admin/customers", { preHandler: deps.userChain }, c.list);
  app.get<{ Params: { id: number } }>(
    "/admin/customers/:id",
    { preHandler: deps.userChain, schema: { params: schema.customerIdParams } },
    c.get,
  );
  app.put<{ Params: { id: number }; Body: UpdateCustomerInput }>(
    "/admin/customers/:id",
    {
      preHandler: deps.userChain,
      schema: { params: schema.customerIdParams, body: schema.updateCustomerBody },
    },
    c.update,
  );
  app.delete<{ Params: { id: number } }>(
    "/admin/customers/:id",
    { preHandler: deps.userChain, schema: { params: schema.customerIdParams } },
    c.remove,
  );

  app.get<{ Params: { id: number } }>(
    "/internal/customers/:id",
    {
      preHandler: deps.requireService("billing:customer:read"),
      schema: { params: schema.customerIdParams },
    },
    c.getInternal,
  );
}

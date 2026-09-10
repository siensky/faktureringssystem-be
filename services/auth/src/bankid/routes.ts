import type { FastifyInstance } from "fastify";
import { createBankIdControllers } from "./controllers";
import * as schema from "./schema";
import type { BankIdService } from "./services";

export function registerBankIdRoutes(
  app: FastifyInstance,
  service: BankIdService,
  strictLimit: object,
): void {
  const c = createBankIdControllers(service);
  app.post("/auth/bankid/init", { schema: { body: schema.initBody }, ...strictLimit }, c.init);
  app.post(
    "/auth/bankid/collect",
    { schema: { body: schema.collectBody }, ...strictLimit },
    c.collect,
  );
}

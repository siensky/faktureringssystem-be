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
  // init: hårt per-IP-tak (kostnadsyta) + windowed rate-limit i servicen.
  app.post("/auth/bankid/init", { schema: { body: schema.initBody }, ...strictLimit }, c.init);
  // collect: MÅSTE kunna pollas ofta (var ~2:a sekund i upp till ~3 min).
  // Bara det globala taket gäller — den är billig och kräver ett orderRef
  // som bara init (rate-limitad) kan ge.
  app.post("/auth/bankid/collect", { schema: { body: schema.collectBody } }, c.collect);
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createBankIdControllers } from "./controllers";
import * as schema from "./schema";
import type { BankIdService } from "./services";

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerBankIdRoutes(
  app: FastifyInstance,
  service: BankIdService,
  strictLimit: object,
  requireUser: PreHandler,
): void {
  const c = createBankIdControllers(service);
  // init: hårt per-IP-tak (kostnadsyta) + windowed rate-limit i servicen.
  app.post("/auth/bankid/init", { schema: { body: schema.initBody }, ...strictLimit }, c.init);
  // collect: MÅSTE kunna pollas ofta (var ~2:a sekund i upp till ~3 min).
  // Bara det globala taket gäller — den är billig och kräver ett orderRef
  // som bara init (rate-limitad) kan ge.
  app.post("/auth/bankid/collect", { schema: { body: schema.collectBody } }, c.collect);
  // Fas 12: kräver en redan inloggad BankID-kundidentitet — till skillnad
  // från init/collect är den här INTE öppen.
  app.post<{ Body: { tenantId: number } }>(
    "/auth/companies/switch",
    { preHandler: [requireUser], schema: { body: schema.switchCompanyBody } },
    c.switchCompany,
  );
  app.get("/auth/companies/overview", { preHandler: [requireUser] }, c.overview);
}

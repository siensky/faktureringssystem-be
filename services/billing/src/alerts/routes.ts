// GET /internal/ops/alerts — skyddad drift-endpoint (fas 7), samma mönster
// som payments /internal/ops/payments/unknown-bankgiro och billings egen
// /internal/automation/run: under /internal/ blockerar nginx den utifrån,
// requireService(scope) är enda auth, inget seedat konto som standard.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createAlertsController } from "./controller";
import type { AlertsService } from "./service";

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerAlertsRoutes(
  app: FastifyInstance,
  service: AlertsService,
  deps: { requireService: (scope: string) => PreHandler },
): void {
  const c = createAlertsController(service);

  app.get("/internal/ops/alerts", { preHandler: deps.requireService("ops:alerts:read") }, c.get);
}

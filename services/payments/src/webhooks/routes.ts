// POST /webhooks/payment behöver den RÅ body-bufferten för signaturen
// (domain.md #25 — signaturen räknas FÖRE JSON parsas, och en trasig
// JSON-kropp med fel signatur ska fortfarande ge 401, inte 400). Fastifys
// vanliga content-type-parser för application/json parsar och validerar
// automatiskt INNAN routens handler ens körs — det skulle göra en trasig
// body till ett 400 innan signaturen hunnit kollas.
//
// Lösningen: registrera en egen content-type-parser som lämnar body
// OPARSAD (bara Buffer) — men bara inom EN INKAPSLAD child-plugin-scope
// (app.register(async (instance) => ...)), så resten av tjänstens routes
// (admin/internal/ops) fortsätter få normal JSON-parsning. Fastifys
// parser-registrering är scopad till encapsulation-trädet den registreras
// i, precis som routes/decorators — se Fastifys egen dokumentation om
// "encapsulation".

import type { FastifyInstance } from "fastify";
import type { MatchingService } from "../matching/service";
import { createWebhookController } from "./controller";

export function registerWebhookRoutes(
  app: FastifyInstance,
  deps: { matchingService: MatchingService; webhookSecret: string },
): void {
  app.register(async (instance) => {
    instance.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => {
        done(null, body);
      },
    );

    const c = createWebhookController({
      matchingService: deps.matchingService,
      webhookSecret: deps.webhookSecret,
    });

    instance.post("/webhooks/payment", c.payment);
  });
}

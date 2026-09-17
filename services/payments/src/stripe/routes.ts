// POST /webhooks/stripe behöver den RÅ body-bufferten för signaturen,
// exakt samma skäl och samma lösning som webhooks/routes.ts (encapsulerad
// child-plugin-scope så bara den här routen tappar Fastifys automatiska
// JSON-parsning — se den filens moduldoc för det fulla resonemanget).
//
// POST /internal/payments/stripe-checkout-sessions är S2S (kräver
// tjänste-token + scope, aldrig nåbar utifrån — nginx blockerar /internal/
// helt) och behöver ingen sådan specialbehandling.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createStripeControllers } from "./controllers";
import * as schema from "./schema";
import type { StripeService } from "./service";

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface CreateCheckoutSessionBody {
  invoiceId: number;
}

export function registerStripeRoutes(
  app: FastifyInstance,
  stripeService: StripeService,
  deps: {
    webhookSecret: string;
    requireService: (scope: string) => PreHandler;
  },
): void {
  const c = createStripeControllers({ stripeService, webhookSecret: deps.webhookSecret });

  app.post<{ Body: CreateCheckoutSessionBody }>(
    "/internal/payments/stripe-checkout-sessions",
    {
      preHandler: deps.requireService("payments:stripe:checkout"),
      schema: { body: schema.createCheckoutSessionBody },
    },
    c.createCheckoutSession,
  );

  app.register(async (instance) => {
    instance.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => {
        done(null, body);
      },
    );
    instance.post("/webhooks/stripe", c.webhook);
  });
}

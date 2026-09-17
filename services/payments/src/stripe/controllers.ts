import {
  BadRequest,
  Unauthorized,
  requireTenantHeader,
  resolveCorrelationId,
  serviceContextOf,
} from "@faktura/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { StripeCheckoutEvent, StripeService } from "./service";
import { verifyStripeSignature } from "./signature";

interface CreateCheckoutSessionBody {
  invoiceId: number;
}

export function createStripeControllers(deps: {
  stripeService: StripeService;
  webhookSecret: string;
}) {
  return {
    async createCheckoutSession(
      request: FastifyRequest<{ Body: CreateCheckoutSessionBody }>,
      reply: FastifyReply,
    ) {
      const tenantId = requireTenantHeader(request);
      const svc = serviceContextOf(request);
      const result = await deps.stripeService.createCheckoutSession({
        tenantId,
        invoiceId: request.body.invoiceId,
        correlationId: svc.correlationId,
      });
      return reply.status(201).send(result);
    },

    /**
     * Rå body (routes.ts registrerar en egen content-type-parser, samma
     * mönster som webhooks/routes.ts) — signaturen räknas FÖRE JSON
     * parsas (domain.md #25).
     */
    async webhook(request: FastifyRequest, reply: FastifyReply) {
      const rawBody = request.body as Buffer;
      const header = String(request.headers["stripe-signature"] ?? "");

      if (!verifyStripeSignature({ secret: deps.webhookSecret, header, rawBody })) {
        throw new Unauthorized("Ogiltig signatur");
      }

      let event: StripeCheckoutEvent;
      try {
        event = JSON.parse(rawBody.toString("utf8")) as StripeCheckoutEvent;
      } catch {
        throw new BadRequest("Ogiltig JSON");
      }
      if (!event?.id || !event?.type || !event?.data?.object?.id) {
        throw new BadRequest("id, type och data.object.id krävs");
      }

      // event.id (Stripes "evt_..."-format) är ALDRIG ett giltigt UUID —
      // correlationId går ner i event_outbox.correlation_id (UUID-kolumn),
      // så fallbacken måste vara ett riktigt genererat UUID, inte Stripes
      // eget id. resolveCorrelationId gör precis det (och validerar en
      // eventuell inskickad header), samma helper requireUser/requireService
      // redan använder.
      const correlationId = resolveCorrelationId(request.headers["x-correlation-id"]);
      await deps.stripeService.handleCheckoutCompleted(event, correlationId);

      // Alltid 200 vid giltig signatur, oavsett om eventet ledde till en
      // bokföring — Stripe tolkar allt annat som "leverera igen", och en
      // ignorerad eventtyp eller en dubblett ska inte trigga en omsändning
      // (samma princip som webhooks/controller.ts:s mockbank-webhook).
      return reply.status(200).send({ received: true });
    },
  };
}

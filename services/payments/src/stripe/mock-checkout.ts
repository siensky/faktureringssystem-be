// Fas 13: en RIKTIG, klickbar sida för STRIPE_PROVIDER=mock. Innan den
// här filen fanns pekade MockStripeProvider (provider.ts) på
// "https://checkout.stripe.test/..." — en domän som aldrig existerat, så
// en kund som klickade "Betala nu" i en riktig webbläsare fick "site
// can't be reached" (upptäckt i ett manuellt rökprov i apps/portal).
// e2e-sviten besöker aldrig url:en (den simulerar webhook-eventet direkt
// mot POST /webhooks/stripe), så det var ett rent UI/manuellt-testproblem.
//
// Sidan gör vad en riktig Stripe Checkout-sida gör: visar beloppet, låter
// kunden "betala" eller avbryta, och landar tillbaka på success_url/
// cancel_url — men "betala" anropar handleCheckoutCompleted() direkt i
// samma process i stället för ett riktigt kortnät, exakt det POST
// /webhooks/stripe också gör efter sin signaturkontroll.
//
// Bara registrerad när STRIPE_PROVIDER=mock (index.ts) — kan alltså aldrig
// nås i produktion (config.ts kraschar redan vid uppstart om mocken vore
// aktiv där, samma disciplin som BANKID_PROVIDER).

import { resolveCorrelationId } from "@faktura/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { StripeService } from "./service";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface CheckoutQuery {
  success_url?: string;
  cancel_url?: string;
}

export function registerMockCheckoutRoutes(
  app: FastifyInstance,
  stripeService: StripeService,
): void {
  app.get<{ Params: { sessionId: string }; Querystring: CheckoutQuery }>(
    "/mock-checkout/:sessionId",
    async (
      request: FastifyRequest<{ Params: { sessionId: string }; Querystring: CheckoutQuery }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const { success_url: successUrl, cancel_url: cancelUrl } = request.query;
      const session = await stripeService.getSessionForMockCheckout(sessionId);
      if (!session || !successUrl || !cancelUrl) {
        return reply
          .status(404)
          .type("text/html")
          .send("<p>Sessionen finns inte eller har gått ut.</p>");
      }
      // Ett omladdat/tillbakaklickat fönster efter redan genomförd
      // betalning — skicka bara vidare i stället för att visa en
      // betalbar sida för något som redan är klart.
      if (session.paid_at) {
        return reply.redirect(successUrl, 303);
      }

      const amount = (Number(session.amount_ore) / 100).toLocaleString("sv-SE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const confirmUrl = `/mock-checkout/${encodeURIComponent(sessionId)}/confirm?success_url=${encodeURIComponent(successUrl)}`;

      return reply.type("text/html").send(`<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mock Stripe Checkout</title>
<style>
  /* Utan detta tvingar en mörkt-läge-webbläsare (t.ex. Chrome i macOS
     mörkt läge) egna färger på en sida som inte deklarerar sitt eget
     schema — resultatet blir mörk text på nästan lika mörk bakgrund
     (upptäckt i ett manuellt rökprov: beloppet var i praktiken osynligt). */
  :root { color-scheme: light; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 420px; margin: 80px auto; padding: 0 24px; color: #0f172a; background: #fff; }
  .badge { display: inline-block; background: #fef3c7; color: #92400e; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; font-weight: 500; color: #64748b; }
  .amount { font-size: 36px; font-weight: 700; margin: 24px 0; }
  button { background: #0a2540; color: #fff; border: 0; border-radius: 6px; padding: 14px 20px; font-size: 15px; font-weight: 500; cursor: pointer; width: 100%; }
  button:hover { background: #1a3a5c; }
  a.cancel { display: block; text-align: center; margin-top: 16px; color: #64748b; text-decoration: none; font-size: 14px; }
</style>
</head>
<body>
  <span class="badge">TESTLÄGE — ingen riktig betalning</span>
  <h1>Faktura ${session.invoice_id}</h1>
  <div class="amount">${amount} ${escapeHtml(session.currency)}</div>
  <form method="POST" action="${escapeHtml(confirmUrl)}">
    <button type="submit">Betala (simulerad)</button>
  </form>
  <a class="cancel" href="${escapeHtml(cancelUrl)}">Avbryt</a>
</body>
</html>`);
    },
  );

  // Egen content-type-parser (samma trick som routes.ts:s /webhooks/stripe)
  // — det vanliga HTML-formuläret POST:ar som application/x-www-form-
  // urlencoded, och Fastifys standardparsning kräver JSON. success_url
  // kommer med som en query-parameter i stället (se confirmUrl ovan), så
  // formulärets body behöver inte parsas alls.
  app.register(async (instance) => {
    instance.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "buffer" },
      (_request, _body, done) => done(null, {}),
    );
    instance.post<{ Params: { sessionId: string }; Querystring: { success_url?: string } }>(
      "/mock-checkout/:sessionId/confirm",
      async (request, reply) => {
        const { sessionId } = request.params;
        const successUrl = request.query.success_url;
        if (!successUrl) return reply.status(400).send("success_url saknas");

        const correlationId = resolveCorrelationId(request.headers["x-correlation-id"]);
        await stripeService.handleCheckoutCompleted(
          {
            id: `evt_mock_${sessionId}`,
            type: "checkout.session.completed",
            data: { object: { id: sessionId } },
          },
          correlationId,
        );
        return reply.redirect(successUrl, 303);
      },
    );
  });
}

// Stripe bakom ett gränssnitt med två implementationer — samma mönster
// som services/auth/src/bankid/provider.ts (architecture.md #25,
// mock-undantaget: "mockade externa tjänster... betalningar, där det
// andra fallet är testet", och testing.md #12: "mocka bara det du inte
// äger — BankID, e-postleverantör, betalleverantör").
//
// Till skillnad från BankID (där RealBankIdProvider är omöjlig att köra
// i en pipeline och därför skjuts till fas 11) är Stripes testläge en
// riktig, skriptbar HTTP-API utan hemlig ceremoni — RealStripeProvider
// byggs alltså redan nu, mot Stripes egen REST-API via fetch (ingen SDK,
// samma "inget beroende för ett enda anrop"-linje som resten av
// tjänstens S2S-klienter). MockStripeProvider används i dev/CI så
// e2e-sviten aldrig behöver ett riktigt Stripe-konto eller nätåtkomst.

export interface CreateCheckoutSessionParams {
  amountOre: number;
  currency: string;
  tenantId: number;
  invoiceId: number;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

export interface StripeProvider {
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSession>;
}

/**
 * Ingen nätverksanrop. sessionId är deterministisk (härledd ur tenant+
 * faktura, inte slumpad) så ett e2e-test kan skapa en session och sedan
 * bygga ett matchande simulerat webhook-event utan att behöva läsa
 * tillbaka id:t ur ett API-svar den inte litar på i förväg.
 */
export class MockStripeProvider implements StripeProvider {
  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSession> {
    const sessionId = `cs_test_mock_${params.tenantId}_${params.invoiceId}_${Date.now()}`;
    return { sessionId, url: `https://checkout.stripe.test/mock/${sessionId}` };
  }
}

/**
 * Riktig Stripe Checkout Sessions-API i testläge (STRIPE_SECRET_KEY ska
 * vara en sk_test_-nyckel — se services/payments/src/config.ts:s
 * produktionsspärr). `mode=payment`, ett enda radobjekt med hela
 * beloppet — kunden delbetalar inte INIFRÅN Stripe, det gör systemet
 * redan (invoice_payments, en rad per betalning).
 */
export class RealStripeProvider implements StripeProvider {
  constructor(private readonly secretKey: string) {}

  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSession> {
    const body = new URLSearchParams({
      mode: "payment",
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": params.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(params.amountOre),
      "line_items[0][price_data][product_data][name]": `Faktura ${params.invoiceId}`,
      // Metadata följer med tillbaka på webhook-eventet — det är HÄR
      // payments hämtar tenantId/invoiceId, inte från något klienten
      // skickar (domain.md #27).
      "metadata[tenantId]": String(params.tenantId),
      "metadata[invoiceId]": String(params.invoiceId),
    });

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Stripe checkout/sessions svarade ${res.status}: ${detail}`);
    }
    const json = (await res.json()) as { id: string; url: string };
    return { sessionId: json.id, url: json.url };
  }
}

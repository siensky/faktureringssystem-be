// Verifiering av Stripes webhook-signatur (den RIKTIGA algoritmen Stripe
// använder — se https://stripe.com/docs/webhooks#verify-manually).
// Skiljer sig i FORMAT från services/payments/src/webhooks/signature.ts
// (en enda "Stripe-Signature"-header med t=/v1=-par i stället för två
// separata headers), men samma underliggande idé: HMAC-SHA256 över
// "<timestamp>.<rå body>", konstant-tid-jämförelse, tidsfönster mot
// replay (domain.md #25).
//
// Ingen nätverksanrop och inget Stripe-konto krävs för att VERIFIERA —
// precis som webhooks/signature.ts kan både riktig Stripe-trafik och ett
// e2e-test som signerar sin egen simulerade payload med samma
// STRIPE_WEBHOOK_SECRET verifieras av samma kod.

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TOLERANCE_SECONDS = 300;

/** Parsar "t=123,v1=abc,v1=def" — Stripe kan skicka flera v1-värden vid
 *  nyckelrotation; vilket som helst som matchar räcker. */
function parseHeader(header: string): { timestamp: string | undefined; signatures: string[] } {
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t" && value) timestamp = value;
    else if (key === "v1" && value) signatures.push(value);
  }
  return { timestamp, signatures };
}

export function verifyStripeSignature(opts: {
  secret: string;
  header: string;
  rawBody: Buffer;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  const { timestamp, signatures } = parseHeader(opts.header);
  if (!timestamp || signatures.length === 0) return false;

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return false;
  const now = opts.now ?? Date.now() / 1000;
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - sentAt) > tolerance) return false;

  const base = Buffer.concat([Buffer.from(timestamp, "utf8"), Buffer.from("."), opts.rawBody]);
  const expectedHex = createHmac("sha256", opts.secret).update(base).digest("hex");
  const expected = Buffer.from(expectedHex, "utf8");

  // timingSafeEqual kastar på olika längd i stället för att svara false —
  // korta-cirkla på längd läcker inget (ett giltigt HMAC-SHA256-hex har
  // alltid 64 tecken, redan offentlig kunskap), samma resonemang som
  // webhooks/signature.ts:s verifySignature.
  return signatures.some((sig) => {
    const given = Buffer.from(sig, "utf8");
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

/** Bygger en giltig Stripe-Signature-header — för enhetstestet av
 *  verifyStripeSignature (round-trip). e2e-sviten importerar INTE den
 *  här filen (e2e är en svartlådeklient, e2e/helpers.ts) utan har sin
 *  egen inlinead kopia, samma mönster som signPaymentWebhook/
 *  signEmailWebhook där. */
export function buildStripeSignatureHeader(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  const base = `${timestamp}.${rawBody}`;
  const signature = createHmac("sha256", secret).update(base, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

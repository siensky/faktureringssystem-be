// Enhetstest för Stripe-webhookens signaturverifiering (PLAN.md fas 10,
// domain.md #25). Ren HMAC-logik, samma nivå som webhooks/signature.ts:s
// egna test (om det fanns ett) — inget nätverk, inget Stripe-konto.

import { describe, expect, test } from "bun:test";
import { buildStripeSignatureHeader, verifyStripeSignature } from "../src/stripe/signature";

const SECRET = "test-stripe-webhook-secret";
const BODY = Buffer.from('{"id":"evt_1","type":"checkout.session.completed"}', "utf8");

describe("verifyStripeSignature", () => {
  test("giltig signatur och färsk tidsstämpel -> true", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = buildStripeSignatureHeader(SECRET, String(now), BODY.toString("utf8"));
    expect(verifyStripeSignature({ secret: SECRET, header, rawBody: BODY, now })).toBe(true);
  });

  test("fel hemlighet -> false", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = buildStripeSignatureHeader("fel-hemlighet", String(now), BODY.toString("utf8"));
    expect(verifyStripeSignature({ secret: SECRET, header, rawBody: BODY, now })).toBe(false);
  });

  test("manipulerad body -> false", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = buildStripeSignatureHeader(SECRET, String(now), BODY.toString("utf8"));
    const tampered = Buffer.from('{"id":"evt_1","type":"tampered"}', "utf8");
    expect(verifyStripeSignature({ secret: SECRET, header, rawBody: tampered, now })).toBe(false);
  });

  test("för gammal tidsstämpel -> false (replayskydd)", () => {
    const now = Math.floor(Date.now() / 1000);
    const old = now - 600; // 10 minuter, utanför standardfönstret på 5
    const header = buildStripeSignatureHeader(SECRET, String(old), BODY.toString("utf8"));
    expect(verifyStripeSignature({ secret: SECRET, header, rawBody: BODY, now })).toBe(false);
  });

  test("saknad header -> false, kastar aldrig", () => {
    expect(verifyStripeSignature({ secret: SECRET, header: "", rawBody: BODY })).toBe(false);
  });

  test("flera v1-värden — matchar om NÅGOT av dem är rätt (nyckelrotation)", () => {
    const now = Math.floor(Date.now() / 1000);
    const correct = buildStripeSignatureHeader(SECRET, String(now), BODY.toString("utf8"));
    const header = `t=${now},v1=fel_signatur,${correct.split(",")[1]}`;
    expect(verifyStripeSignature({ secret: SECRET, header, rawBody: BODY, now })).toBe(true);
  });
});

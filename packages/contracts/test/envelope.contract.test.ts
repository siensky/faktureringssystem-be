// Kontraktstest: validerar samma fixture-filer som Python-sidans
// tests/test_contract.py validerar, mot samma schemafil. Går båda gröna
// betyder det att TS och Python ser eventet på exakt samma sätt — det är
// hela poängen med att inte handskriva typerna separat i två språk.

import { describe, expect, test } from "bun:test";
import {
  assertValidEnvelope,
  assertValidPayload,
  isValidEnvelope,
  isValidPayload,
  loadFixture,
} from "../src/index";

describe("event-envelopen (kontrakt delat med Python)", () => {
  test("en giltig envelope passerar valideringen", () => {
    const valid = loadFixture("valid-envelope.json");
    expect(isValidEnvelope(valid)).toBe(true);
    expect(() => assertValidEnvelope(valid)).not.toThrow();
  });

  test("saknad tenantId avvisas — architecture.md #4", () => {
    const invalid = loadFixture("invalid-envelope-missing-tenant.json");
    expect(isValidEnvelope(invalid)).toBe(false);
    expect(() => assertValidEnvelope(invalid)).toThrow(/tenantId/);
  });

  test("eventType som inte är <entitet>.<verb> avvisas — architecture.md Event", () => {
    const invalid = loadFixture("invalid-envelope-bad-event-type.json");
    expect(isValidEnvelope(invalid)).toBe(false);
  });

  test("extra fält utöver envelopen avvisas (additionalProperties: false)", () => {
    const valid = loadFixture("valid-envelope.json") as Record<string, unknown>;
    const withExtra = { ...valid, unexpectedField: "should not be here" };
    expect(isValidEnvelope(withExtra)).toBe(false);
  });
});

describe("payload per eventtyp (kontrakt delat med Python)", () => {
  // Filnamn = eventtyp med punkt/understreck -> bindestreck.
  const cases: Array<{ fixture: string; eventType: string }> = [
    { fixture: "events/invoice-sent.json", eventType: "invoice.sent" },
    { fixture: "events/invoice-credited.json", eventType: "invoice.credited" },
    { fixture: "events/invoice-delivery-updated.json", eventType: "invoice.delivery_updated" },
  ];

  for (const { fixture, eventType } of cases) {
    test(`${eventType}: giltig payload passerar`, () => {
      const envelope = loadFixture(fixture) as { eventType: string; payload: unknown };
      expect(envelope.eventType).toBe(eventType);
      expect(isValidEnvelope(envelope)).toBe(true);
      expect(isValidPayload(eventType, envelope.payload)).toBe(true);
      expect(() => assertValidPayload(eventType, envelope.payload)).not.toThrow();
    });
  }

  test("invoice.delivery_updated: okänt deliveryStatus avvisas", () => {
    const envelope = loadFixture("events/invalid-invoice-delivery-updated-bad-status.json") as {
      payload: unknown;
    };
    expect(isValidPayload("invoice.delivery_updated", envelope.payload)).toBe(false);
    expect(() => assertValidPayload("invoice.delivery_updated", envelope.payload)).toThrow(
      /deliveryStatus/,
    );
  });

  test("invoice.sent: extra fält i payloaden avvisas (additionalProperties: false)", () => {
    expect(isValidPayload("invoice.sent", { invoiceId: 1, extra: true })).toBe(false);
  });

  test("en eventtyp utan schema är ett kodfel, inte en tyst genomsläppning", () => {
    expect(() => assertValidPayload("invoice.nonexistent", {})).toThrow(/inget schema/);
    expect(isValidPayload("invoice.nonexistent", {})).toBe(false);
  });
});

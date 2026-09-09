// Kontraktstest: validerar samma fixture-filer som Python-sidans
// tests/test_contract.py validerar, mot samma schemafil. Går båda gröna
// betyder det att TS och Python ser eventet på exakt samma sätt — det är
// hela poängen med att inte handskriva typerna separat i två språk.

import { describe, expect, test } from "bun:test";
import { assertValidEnvelope, isValidEnvelope, loadFixture } from "../src/index";

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

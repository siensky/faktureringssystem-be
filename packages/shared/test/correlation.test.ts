import { describe, expect, test } from "bun:test";
import { resolveCorrelationId } from "../src";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("resolveCorrelationId", () => {
  test("släpper igenom ett giltigt UUID (gemener)", () => {
    const id = "8F14E45F-CEEA-4B19-8F7C-6BA2F5F4C3A1";
    expect(resolveCorrelationId(id)).toBe(id.toLowerCase());
  });

  test("genererar ett nytt UUID för en icke-UUID-sträng", () => {
    const out = resolveCorrelationId("hej");
    expect(out).toMatch(UUID);
    expect(out).not.toBe("hej");
  });

  test("genererar ett nytt UUID för undefined / fel typ", () => {
    expect(resolveCorrelationId(undefined)).toMatch(UUID);
    expect(resolveCorrelationId(["x"])).toMatch(UUID);
  });
});

// Enhetstest för Stripe-servicens rena beslutslogik (PLAN.md fas 10).
// Samma formel som matching/service.ts:s decideMatch och admin/
// services.ts:s matchInTx — eventtypen är bara informativ (billings
// konsument räknar alltid om från grunden), men val av namn testas ändå
// separat från all DB/HTTP.

import { describe, expect, test } from "bun:test";
import { decideEventType } from "../src/stripe/service";

describe("decideEventType", () => {
  test("beloppet == remainingOre -> payment.matched", () => {
    expect(decideEventType(100_00, 100_00)).toBe("payment.matched");
  });

  test("beloppet > remainingOre -> payment.matched (billings konsument larmar överbetalningen)", () => {
    expect(decideEventType(150_00, 100_00)).toBe("payment.matched");
  });

  test("beloppet < remainingOre -> payment.partial", () => {
    expect(decideEventType(50_00, 100_00)).toBe("payment.partial");
  });
});

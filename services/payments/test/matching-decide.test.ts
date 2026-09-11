// Enhetstest för matchningsmotorns rena beslutslogik (fas 5-planen,
// avsnitt 3). decideMatch() är exporterad separat från match() just för
// att kunna testas utan Postgres — en fejkad MatchingBillingClient räcker.
// Den faktiska DB-skrivningen/eventpubliceringen i match() täcks av
// e2e-sviten i stället (rules/testing.md #12: mocka aldrig den egna
// databasen).

import { describe, expect, test } from "bun:test";
import { deriveOcr } from "@faktura/shared";
import { decideMatch } from "../src/matching/service";
import type { InvoiceForMatching, MatchInput, MatchingBillingClient } from "../src/matching/types";

// Ett riktigt Luhn-giltigt OCR, samma härledningsfunktion billing
// använder vid utskick — decideMatch kör isValidOcr() på formatet innan
// den ens ringer billing, så en påhittad sifferrad räcker inte.
const VALID_OCR = deriveOcr(123);

function input(over: Partial<MatchInput> = {}): MatchInput {
  return {
    source: "webhook:mockbank",
    externalId: "evt_1",
    bankgiro: "12345678",
    ocr: VALID_OCR,
    amountOre: 100_00,
    payerName: "Björn Borg AB",
    bookedAt: new Date("2026-09-10T08:00:00.000Z"),
    correlationId: "corr-1",
    ...over,
  };
}

function fakeBillingClient(opts: {
  tenantId?: number;
  invoice?: InvoiceForMatching;
}): MatchingBillingClient {
  return {
    async resolveTenantByBankgiro() {
      return opts.tenantId;
    },
    async resolveInvoiceByOcr() {
      return opts.invoice;
    },
  };
}

describe("decideMatch", () => {
  test("okänt bankgiro -> unmatched/unknown_bankgiro, ingen tenant", async () => {
    const decision = await decideMatch(fakeBillingClient({ tenantId: undefined }), input());
    expect(decision).toEqual({
      tenantId: null,
      status: "unmatched",
      unmatchedReason: "unknown_bankgiro",
      matchedInvoiceId: null,
    });
  });

  test("ogiltigt OCR-format -> manual_review/unknown_ocr, utan S2S-anrop till by-ocr", async () => {
    let byOcrCalled = false;
    const client: MatchingBillingClient = {
      async resolveTenantByBankgiro() {
        return 7;
      },
      async resolveInvoiceByOcr() {
        byOcrCalled = true;
        return undefined;
      },
    };
    const decision = await decideMatch(client, input({ ocr: "inte-siffror" }));
    expect(decision.status).toBe("manual_review");
    expect(decision.unmatchedReason).toBe("unknown_ocr");
    expect(decision.tenantId).toBe(7);
    expect(byOcrCalled).toBe(false);
  });

  test("giltigt OCR-format men ingen träff hos billing -> manual_review/unknown_ocr", async () => {
    const client = fakeBillingClient({ tenantId: 7, invoice: undefined });
    const decision = await decideMatch(client, input());
    expect(decision.status).toBe("manual_review");
    expect(decision.unmatchedReason).toBe("unknown_ocr");
  });

  test("fakturan är inte i ett bokförbart läge (t.ex. redan paid) -> manual_review/ambiguous", async () => {
    const client = fakeBillingClient({
      tenantId: 7,
      invoice: { currentInvoiceId: 42, status: "paid", remainingOre: 0 },
    });
    const decision = await decideMatch(client, input());
    expect(decision.status).toBe("manual_review");
    expect(decision.unmatchedReason).toBe("ambiguous");
  });

  test("credited faktura -> manual_review/ambiguous", async () => {
    const client = fakeBillingClient({
      tenantId: 7,
      invoice: { currentInvoiceId: 42, status: "credited", remainingOre: 100_00 },
    });
    const decision = await decideMatch(client, input());
    expect(decision.unmatchedReason).toBe("ambiguous");
  });

  test("beloppet överstiger remainingOre -> manual_review/overpayment", async () => {
    const client = fakeBillingClient({
      tenantId: 7,
      invoice: { currentInvoiceId: 42, status: "sent", remainingOre: 50_00 },
    });
    const decision = await decideMatch(client, input({ amountOre: 100_00 }));
    expect(decision.status).toBe("manual_review");
    expect(decision.unmatchedReason).toBe("overpayment");
  });

  test("beloppet == remainingOre -> matched, eventType payment.matched", async () => {
    const client = fakeBillingClient({
      tenantId: 7,
      invoice: { currentInvoiceId: 42, status: "sent", remainingOre: 100_00 },
    });
    const decision = await decideMatch(client, input({ amountOre: 100_00 }));
    expect(decision).toEqual({
      tenantId: 7,
      status: "matched",
      unmatchedReason: null,
      matchedInvoiceId: 42,
      eventType: "payment.matched",
    });
  });

  test("beloppet < remainingOre -> matched, eventType payment.partial", async () => {
    const client = fakeBillingClient({
      tenantId: 7,
      invoice: { currentInvoiceId: 42, status: "overdue", remainingOre: 200_00 },
    });
    const decision = await decideMatch(client, input({ amountOre: 100_00 }));
    expect(decision.status).toBe("matched");
    expect(decision.eventType).toBe("payment.partial");
    expect(decision.matchedInvoiceId).toBe(42);
  });

  test("overdue-faktura kan bokföras precis som sent", async () => {
    const client = fakeBillingClient({
      tenantId: 7,
      invoice: { currentInvoiceId: 42, status: "overdue", remainingOre: 100_00 },
    });
    const decision = await decideMatch(client, input({ amountOre: 100_00 }));
    expect(decision.status).toBe("matched");
  });
});

// Speglar services/billing/test/vat.test.ts:s fall exakt — bevisar att
// InvoiceFormPage:s live-summering (lib/vat.ts) ger samma öresbelopp som
// backend faktiskt bokför (code review-fynd #5: en tidigare, enklare
// kronor-flyttalsberäkning kunde glida en öre eller så från facit).

import { describe, expect, test } from "bun:test";
import { computeLineOre, roundHalfUp } from "../src/lib/vat";

describe("roundHalfUp", () => {
  test("halvvägs rundas uppåt", () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(2.5)).toBe(3);
  });
  test("under halvvägs rundas nedåt", () => {
    expect(roundHalfUp(1.49)).toBe(1);
    expect(roundHalfUp(0.999)).toBe(1);
    expect(roundHalfUp(0.1)).toBe(0);
  });
});

describe("computeLineOre", () => {
  test("25% moms på jämnt belopp", () => {
    expect(computeLineOre(1, 10000, 25)).toEqual({
      lineExclVatOre: 10000,
      lineVatOre: 2500,
      lineInclVatOre: 12500,
    });
  });

  test("bråkdelskvantitet avrundas en gång på radnivå", () => {
    // 2,5 h * 33333 öre = 83332,5 -> 83333
    const line = computeLineOre(2.5, 33333, 25);
    expect(line.lineExclVatOre).toBe(83333);
    // 83333 * 0,25 = 20833,25 -> 20833
    expect(line.lineVatOre).toBe(20833);
    expect(line.lineInclVatOre).toBe(104166);
  });

  test("moms 0 ger noll momsbelopp", () => {
    expect(computeLineOre(3, 999, 0)).toEqual({
      lineExclVatOre: 2997,
      lineVatOre: 0,
      lineInclVatOre: 2997,
    });
  });

  test("halv öre i momsen rundas uppåt", () => {
    expect(computeLineOre(1, 2, 25).lineVatOre).toBe(1);
  });

  test("bråkkvantitet med flyttalsdrift avrundas rätt (1,115 * 100 öre = 111,5 -> 112)", () => {
    expect(computeLineOre(1.115, 100, 0).lineExclVatOre).toBe(112);
    expect(computeLineOre(0.145, 100, 0).lineExclVatOre).toBe(15);
    expect(computeLineOre(10.075, 100, 0).lineExclVatOre).toBe(1008);
  });
});

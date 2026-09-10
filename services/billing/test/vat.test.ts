import { describe, expect, test } from "bun:test";
import { VAT_RATES, computeLine, negateLine, roundHalfUp, sumTotals } from "../src/domain/vat";

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
  test("heltal lämnas orörda", () => {
    expect(roundHalfUp(0)).toBe(0);
    expect(roundHalfUp(12345)).toBe(12345);
  });
});

describe("computeLine", () => {
  test("25% moms på jämnt belopp", () => {
    expect(computeLine({ quantity: 1, unitPriceOre: 10000, vatRate: 25 })).toEqual({
      lineExclVatOre: 10000,
      lineVatOre: 2500,
      lineInclVatOre: 12500,
    });
  });

  test("bråkdelskvantitet avrundas en gång på radnivå", () => {
    // 2,5 h * 33333 öre = 83332,5 -> 83333
    const line = computeLine({ quantity: 2.5, unitPriceOre: 33333, vatRate: 25 });
    expect(line.lineExclVatOre).toBe(83333);
    // 83333 * 0,25 = 20833,25 -> 20833
    expect(line.lineVatOre).toBe(20833);
    expect(line.lineInclVatOre).toBe(104166);
  });

  test("moms 0 ger noll momsbelopp", () => {
    const line = computeLine({ quantity: 3, unitPriceOre: 999, vatRate: 0 });
    expect(line).toEqual({ lineExclVatOre: 2997, lineVatOre: 0, lineInclVatOre: 2997 });
  });

  test("halv öre i momsen rundas uppåt", () => {
    // excl 2 öre, 25% = 0,5 öre -> 1 öre
    expect(computeLine({ quantity: 1, unitPriceOre: 2, vatRate: 25 }).lineVatOre).toBe(1);
  });

  test("alla tillåtna momssatser fungerar", () => {
    for (const rate of VAT_RATES) {
      const line = computeLine({ quantity: 1, unitPriceOre: 10000, vatRate: rate });
      expect(line.lineVatOre).toBe(roundHalfUp((10000 * rate) / 100));
    }
  });
});

describe("sumTotals", () => {
  test("summerar avrundade radbelopp utan ny avrundning", () => {
    const lines = [
      computeLine({ quantity: 1, unitPriceOre: 3333, vatRate: 25 }), // 3333 / 833 / 4166
      computeLine({ quantity: 1, unitPriceOre: 6667, vatRate: 25 }), // 6667 / 1667 / 8334
    ];
    expect(sumTotals(lines)).toEqual({
      totalExclVatOre: 10000,
      totalVatOre: 2500,
      totalInclVatOre: 12500,
    });
  });

  test("tom faktura ger nollor", () => {
    expect(sumTotals([])).toEqual({
      totalExclVatOre: 0,
      totalVatOre: 0,
      totalInclVatOre: 0,
    });
  });
});

describe("negateLine", () => {
  test("speglar en rad exakt med ombytt tecken", () => {
    const orig = computeLine({ quantity: 2.5, unitPriceOre: 33333, vatRate: 25 });
    const credit = negateLine(orig);
    expect(credit).toEqual({
      lineExclVatOre: -83333,
      lineVatOre: -20833,
      lineInclVatOre: -104166,
    });
    expect(sumTotals([orig, credit])).toEqual({
      totalExclVatOre: 0,
      totalVatOre: 0,
      totalInclVatOre: 0,
    });
  });
});

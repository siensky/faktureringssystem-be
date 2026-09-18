import { describe, expect, test } from "bun:test";
import { addDays, advanceByInterval, dayOfMonth, todayInStockholm } from "../src/domain/dates";

describe("todayInStockholm", () => {
  test("svensk sommartid ligger före UTC-midnatt", () => {
    // 2026-07-01 00:30 UTC = 02:30 svensk sommartid, fortfarande 1 juli
    expect(todayInStockholm(new Date("2026-07-01T00:30:00Z"))).toBe("2026-07-01");
  });
  test("strax före midnatt UTC på sommaren är redan nästa dag i Sverige", () => {
    // 2026-06-30 23:30 UTC = 01:30 svensk tid 1 juli
    expect(todayInStockholm(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });
  test("vintertid", () => {
    expect(todayInStockholm(new Date("2026-01-15T10:00:00Z"))).toBe("2026-01-15");
  });
});

describe("addDays", () => {
  test("lägger till dygn inom månaden", () => {
    expect(addDays("2026-03-01", 30)).toBe("2026-03-31");
  });
  test("hanterar månadsskifte", () => {
    expect(addDays("2026-01-20", 30)).toBe("2026-02-19");
  });
  test("hanterar DST-övergången utan att tappa ett dygn", () => {
    // Svensk DST 2026: framåt 29 mars, tillbaka 25 oktober
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
  test("noll dygn ger samma datum", () => {
    expect(addDays("2026-05-05", 0)).toBe("2026-05-05");
  });
});

// Fas 6: invoice_templates.next_generation_date rullas fram med
// advanceByInterval. Ren kalenderräkning (ingen DST-påverkan — bara
// klockslag/dygnsaddition rör vid det), men månadslängd varierar och ska
// KLAMPAS mot det ORIGINALA ankardygnet (billing_day), inte mot förra
// periodens (kanske redan klampade) datum — annars driver mallen permanent
// iväg (kodgranskning PR #6, fynd 3, se advanceByInterval:s docstring).
describe("advanceByInterval", () => {
  test("monthly inom samma år", () => {
    expect(advanceByInterval("2026-01-15", "monthly", 15)).toBe("2026-02-15");
  });
  test("monthly klampar vid kortare målmånad (31 jan -> feb)", () => {
    expect(advanceByInterval("2026-01-31", "monthly", 31)).toBe("2026-02-28"); // 2026 ej skottår
  });
  test("monthly klampar vid skottår", () => {
    expect(advanceByInterval("2028-01-31", "monthly", 31)).toBe("2028-02-29"); // 2028 är skottår
  });
  test("monthly över årsskifte", () => {
    expect(advanceByInterval("2026-12-15", "monthly", 15)).toBe("2027-01-15");
  });
  test("quarterly", () => {
    expect(advanceByInterval("2026-01-31", "quarterly", 31)).toBe("2026-04-30");
  });
  test("quarterly över årsskifte", () => {
    expect(advanceByInterval("2026-11-30", "quarterly", 30)).toBe("2027-02-28");
  });
  test("yearly på skottdagen -> icke-skottår klampar till 28 feb", () => {
    expect(advanceByInterval("2028-02-29", "yearly", 29)).toBe("2029-02-28");
  });
  test("yearly på en vanlig dag", () => {
    expect(advanceByInterval("2026-06-15", "yearly", 15)).toBe("2027-06-15");
  });

  test("återhämtar ankardygnet efter en kort månad (fynd 3, kodgranskning PR #6)", () => {
    const billingDay = 31;
    const afterJan = advanceByInterval("2026-01-31", "monthly", billingDay);
    expect(afterJan).toBe("2026-02-28"); // klampat — februari har bara 28 dagar 2026

    // Kedjar vidare från februaris (redan klampade) datum, precis som
    // services.ts gör varje körning. Klampar man mot next_generation_date
    // egen dag (28) i stället för det bevarade ankardygnet blir detta FEL
    // "2026-03-28" — mars har 31 dagar och ska återhämta den sanna 31:an.
    const afterFeb = advanceByInterval(afterJan, "monthly", billingDay);
    expect(afterFeb).toBe("2026-03-31");
  });
});

// Fas 13: mallens ankardygn (invoice_templates.billing_day) härleds från
// admins valda nextGenerationDate vid skapande/redigering.
describe("dayOfMonth", () => {
  test("dagen i mitten av månaden", () => {
    expect(dayOfMonth("2026-03-15")).toBe(15);
  });
  test("sista dagen i en lång månad", () => {
    expect(dayOfMonth("2026-01-31")).toBe(31);
  });
  test("första dagen i månaden", () => {
    expect(dayOfMonth("2026-07-01")).toBe(1);
  });
});

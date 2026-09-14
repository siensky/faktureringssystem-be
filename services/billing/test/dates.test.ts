import { describe, expect, test } from "bun:test";
import { addDays, advanceByInterval, todayInStockholm } from "../src/domain/dates";

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
// KLAMPAS, inte spilla över till nästa månad.
describe("advanceByInterval", () => {
  test("monthly inom samma år", () => {
    expect(advanceByInterval("2026-01-15", "monthly")).toBe("2026-02-15");
  });
  test("monthly klampar vid kortare målmånad (31 jan -> feb)", () => {
    expect(advanceByInterval("2026-01-31", "monthly")).toBe("2026-02-28"); // 2026 ej skottår
  });
  test("monthly klampar vid skottår", () => {
    expect(advanceByInterval("2028-01-31", "monthly")).toBe("2028-02-29"); // 2028 är skottår
  });
  test("monthly över årsskifte", () => {
    expect(advanceByInterval("2026-12-15", "monthly")).toBe("2027-01-15");
  });
  test("quarterly", () => {
    expect(advanceByInterval("2026-01-31", "quarterly")).toBe("2026-04-30");
  });
  test("quarterly över årsskifte", () => {
    expect(advanceByInterval("2026-11-30", "quarterly")).toBe("2027-02-28");
  });
  test("yearly på skottdagen -> icke-skottår klampar till 28 feb", () => {
    expect(advanceByInterval("2028-02-29", "yearly")).toBe("2029-02-28");
  });
  test("yearly på en vanlig dag", () => {
    expect(advanceByInterval("2026-06-15", "yearly")).toBe("2027-06-15");
  });
});

import { describe, expect, test } from "bun:test";
import {
  isValidBankgiro,
  isValidOrgNumber,
  isValidPnr,
  luhn,
  normalizePnr,
} from "../src/swedish-id";

describe("luhn", () => {
  test("kända giltiga och ogiltiga strängar", () => {
    expect(luhn("8112189876")).toBe(true); // Skatteverkets testpersonnummer
    expect(luhn("8112189875")).toBe(false);
    expect(luhn("abc")).toBe(false);
  });
});

describe("normalizePnr", () => {
  test("12 siffror lämnas orörda", () => {
    expect(normalizePnr("198112189876")).toBe("198112189876");
    expect(normalizePnr("19811218-9876")).toBe("198112189876");
  });

  test("10 siffror expanderas med sekel så personen inte blir ofödd", () => {
    // 45-årig person år 2026 -> 19-hundratal
    const y = new Date().getUTCFullYear();
    const yy = String((y - 45) % 100).padStart(2, "0");
    expect(normalizePnr(`${yy}0101-0000`).slice(0, 4)).toBe(String(y - 45));
  });

  test("plustecken drar seklet 100 år bakåt", () => {
    const y = new Date().getUTCFullYear();
    const yy = String((y - 10) % 100).padStart(2, "0");
    // utan + skulle det bli y-10; med + blir det y-110
    expect(normalizePnr(`${yy}0101+0000`).slice(0, 4)).toBe(String(y - 110));
  });

  test("skräp kastar", () => {
    expect(() => normalizePnr("12345")).toThrow();
    expect(() => normalizePnr("")).toThrow();
  });
});

describe("isValidPnr", () => {
  test("giltigt testpersonnummer", () => {
    expect(isValidPnr("198112189876")).toBe(true);
    expect(isValidPnr("811218-9876")).toBe(true);
  });
  test("fel kontrollsiffra", () => {
    expect(isValidPnr("198112189875")).toBe(false);
  });
  test("nollor har giltig Luhn men omöjligt datum", () => {
    expect(isValidPnr("000000000000")).toBe(false);
  });
  test("samordningsnummer (dag + 60) accepteras", () => {
    // 811278-2340: dag 78 - 60 = 18, giltig Luhn
    expect(isValidPnr("198112782340")).toBe(true);
  });
});

describe("isValidOrgNumber", () => {
  test("10 siffror med giltig Luhn", () => {
    expect(isValidOrgNumber("5560360793")).toBe(true); // giltig Luhn
    expect(isValidOrgNumber("556036-0793")).toBe(true);
    expect(isValidOrgNumber("5560360794")).toBe(false);
    expect(isValidOrgNumber("12345")).toBe(false);
  });
});

describe("isValidBankgiro", () => {
  test("7–8 siffror med giltig Luhn", () => {
    expect(isValidBankgiro("50511781")).toBe(true);
    expect(isValidBankgiro("5051-1781")).toBe(true);
    expect(isValidBankgiro("5051-1782")).toBe(false);
    expect(isValidBankgiro("123")).toBe(false);
  });
});

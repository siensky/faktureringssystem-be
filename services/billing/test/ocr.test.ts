import { describe, expect, test } from "bun:test";
import { deriveOcr, isValidOcr } from "../src/domain/ocr";

// Oberoende Luhn-validator (klassisk vänster-till-höger-variant) för att
// korskontrollera deriveOcr utan att återanvända dess egen implementation.
function luhnValid(number: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let d = number.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

describe("deriveOcr", () => {
  test("kända värden", () => {
    // base + längdsiffra ((base.length+2) % 10) + Luhn-kontrollsiffra
    expect(deriveOcr(1)).toBe("133");
    expect(deriveOcr(1234)).toBe("123463");
  });

  test("resultatet är alltid Luhn-giltigt", () => {
    for (const n of [1, 2, 7, 42, 99, 100, 999, 1000, 123456, 999999999]) {
      expect(luhnValid(deriveOcr(n))).toBe(true);
    }
  });

  test("längdsiffran speglar total längd mod 10", () => {
    const ocr = deriveOcr(12345); // base 5 siffror -> total 7 -> längdsiffra 7
    const lengthDigit = ocr.slice(-2, -1);
    expect(lengthDigit).toBe("7");
  });

  test("obruten nummerserie ger unika, kollisionsfria OCR", () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 2000; n++) {
      const ocr = deriveOcr(n);
      expect(seen.has(ocr)).toBe(false);
      seen.add(ocr);
    }
  });

  test("avvisar noll och negativa nummer", () => {
    expect(() => deriveOcr(0)).toThrow();
    expect(() => deriveOcr(-5)).toThrow();
    expect(() => deriveOcr(1.5)).toThrow();
  });
});

describe("isValidOcr", () => {
  test("accepterar egna deriveOcr-utdata", () => {
    for (const n of [1, 50, 4711, 100000]) {
      expect(isValidOcr(deriveOcr(n))).toBe(true);
    }
  });

  test("förkastar manipulerade nummer", () => {
    const ok = deriveOcr(4711);
    const tampered = `${ok.slice(0, -1)}${(Number(ok.slice(-1)) + 1) % 10}`;
    expect(isValidOcr(tampered)).toBe(false);
    expect(isValidOcr("")).toBe(false);
    expect(isValidOcr("12")).toBe(false);
    expect(isValidOcr("abc")).toBe(false);
  });

  test("förkastar fel längdsiffra", () => {
    // deriveOcr(1) = "133"; byt längdsiffran 3 -> 9
    expect(isValidOcr("193")).toBe(false);
  });
});

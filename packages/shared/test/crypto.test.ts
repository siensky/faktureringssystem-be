import { describe, expect, test } from "bun:test";
import {
  decryptField,
  encryptField,
  generateKeyHex,
  hmacField,
  timingSafeEqualHex,
} from "../src/crypto";

const KEY_A = generateKeyHex();
const KEY_B = generateKeyHex();

describe("encryptField / decryptField", () => {
  test("dekrypterar till exakt samma sträng", () => {
    const ciphertext = encryptField("19850101-2389", KEY_A);
    expect(decryptField(ciphertext, KEY_A)).toBe("19850101-2389");
  });

  test("samma klartext ger olika chiffertext varje gång (slumpad iv)", () => {
    const a = encryptField("19850101-2389", KEY_A);
    const b = encryptField("19850101-2389", KEY_A);
    expect(a).not.toBe(b);
  });

  test("dekryptering med fel nyckel kastar i stället för att ge fel data", () => {
    const ciphertext = encryptField("19850101-2389", KEY_A);
    expect(() => decryptField(ciphertext, KEY_B)).toThrow();
  });

  test("manipulerad chiffertext upptäcks (GCM auth tag)", () => {
    const ciphertext = encryptField("19850101-2389", KEY_A);
    const buf = Buffer.from(ciphertext, "base64");
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff; // vänd en bit i sista byten
    const tampered = buf.toString("base64");
    expect(() => decryptField(tampered, KEY_A)).toThrow();
  });

  test("kastar tydligt fel om nyckeln inte är 32 byte", () => {
    expect(() => encryptField("data", "för-kort")).toThrow(/32 byte/);
  });
});

describe("hmacField", () => {
  test("är deterministisk — samma indata ger samma utdata", () => {
    expect(hmacField("19850101-2389", KEY_A)).toBe(hmacField("19850101-2389", KEY_A));
  });

  test("olika nycklar ger olika utdata", () => {
    expect(hmacField("19850101-2389", KEY_A)).not.toBe(hmacField("19850101-2389", KEY_B));
  });

  test("olika indata ger olika utdata", () => {
    expect(hmacField("19850101-2389", KEY_A)).not.toBe(hmacField("19850101-2390", KEY_A));
  });
});

describe("timingSafeEqualHex", () => {
  test("true för identiska strängar", () => {
    const h = hmacField("test", KEY_A);
    expect(timingSafeEqualHex(h, h)).toBe(true);
  });

  test("false för olika strängar av samma längd", () => {
    const a = hmacField("test-a", KEY_A);
    const b = hmacField("test-b", KEY_A);
    expect(timingSafeEqualHex(a, b)).toBe(false);
  });

  test("false för strängar av olika längd, utan att kasta", () => {
    expect(timingSafeEqualHex("ab", "abcd")).toBe(false);
  });
});

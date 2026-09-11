// Enhetstest för det BgMax-LIKNANDE filformatet (förenklat för denna
// övning — se fas 5-planens Kontext-avsnitt punkt 1). Ren funktion, ingen
// DB, ingen I/O.

import { describe, expect, test } from "bun:test";
import { deriveExternalId, parseBgmaxLike } from "../src/import/parser";

const FILE_SHA = "a".repeat(64); // giltig hex-formad sha256, godtyckligt värde för testet

describe("parseBgmaxLike", () => {
  test("välformade rader parsas korrekt", () => {
    const text = "1234567|1230172|150000|Björn Borg AB|2026-09-10|BANK-ext-1";
    const [line] = parseBgmaxLike(text, FILE_SHA);
    expect(line?.ok).toBe(true);
    if (!line?.ok) throw new Error("förväntade ok=true");
    expect(line.bankgiro).toBe("1234567");
    expect(line.ocr).toBe("1230172");
    expect(line.amountOre).toBe(150000);
    expect(line.payerName).toBe("Björn Borg AB");
    expect(line.bookedAt.toISOString().slice(0, 10)).toBe("2026-09-10");
    expect(line.externalId).toBe("BANK-ext-1");
  });

  test("tomma rader hoppas över", () => {
    const text = [
      "1234567|1230172|150000|Björn Borg AB|2026-09-10|ext-1",
      "",
      "   ",
      "7654321|4560283|75000|Elin Persson|2026-09-10|ext-2",
    ].join("\n");
    const lines = parseBgmaxLike(text, FILE_SHA);
    expect(lines).toHaveLength(2);
  });

  test("saknat externalId -> härledd nyckel ur (fileSha256, lineOrdinal)", () => {
    const text = "1234567|1230172|150000|Björn Borg AB|2026-09-10|";
    const [line] = parseBgmaxLike(text, FILE_SHA);
    expect(line?.ok).toBe(true);
    if (!line?.ok) throw new Error("förväntade ok=true");
    expect(line.externalId).toBe(deriveExternalId(FILE_SHA, 0));
    expect(line.externalId).not.toBe("");
  });

  test("felformad rad (fel antal fält) ger ett radspecifikt fel utan att avbryta filen", () => {
    const text = [
      "1234567|1230172|150000|Björn Borg AB|2026-09-10|ext-1",
      "trasig-rad-med-for-fa-falt|123",
      "7654321|4560283|75000|Elin Persson|2026-09-10|ext-2",
    ].join("\n");
    const lines = parseBgmaxLike(text, FILE_SHA);
    expect(lines).toHaveLength(3);
    expect(lines[0]?.ok).toBe(true);
    expect(lines[1]?.ok).toBe(false);
    expect(lines[2]?.ok).toBe(true);
    if (lines[1]?.ok !== false) throw new Error("förväntade ok=false");
    expect(lines[1].error).toMatch(/6 fält/);
  });

  test("ogiltigt amountOre ger ett radspecifikt fel", () => {
    const text = "1234567|1230172|noll-kronor|Björn Borg AB|2026-09-10|ext-1";
    const [line] = parseBgmaxLike(text, FILE_SHA);
    expect(line?.ok).toBe(false);
    if (line?.ok !== false) throw new Error("förväntade ok=false");
    expect(line.error).toMatch(/amountOre/);
  });

  test("negativt eller nollställt amountOre avvisas", () => {
    const text = [
      "1234567|1230172|0|x|2026-09-10|ext-1",
      "1234567|1230172|-100|x|2026-09-10|ext-2",
    ].join("\n");
    const lines = parseBgmaxLike(text, FILE_SHA);
    expect(lines.every((l) => l.ok === false)).toBe(true);
  });

  test("ogiltigt bookedDate ger ett radspecifikt fel", () => {
    const text = "1234567|1230172|100000|x|inte-ett-datum|ext-1";
    const [line] = parseBgmaxLike(text, FILE_SHA);
    expect(line?.ok).toBe(false);
    if (line?.ok !== false) throw new Error("förväntade ok=false");
    expect(line.error).toMatch(/bookedDate/);
  });

  test("samma fil parsad två gånger ger identiska härledda nycklar", () => {
    const text = [
      "1234567|1230172|150000|x|2026-09-10|",
      "7654321|4560283|75000|y|2026-09-10|",
    ].join("\n");
    const first = parseBgmaxLike(text, FILE_SHA);
    const second = parseBgmaxLike(text, FILE_SHA);
    expect(first.map((l) => (l.ok ? l.externalId : null))).toEqual(
      second.map((l) => (l.ok ? l.externalId : null)),
    );
  });

  test("payerName saknas (tomt fält) -> null, inte tom sträng", () => {
    const text = "1234567|1230172|150000||2026-09-10|ext-1";
    const [line] = parseBgmaxLike(text, FILE_SHA);
    if (line?.ok !== true) throw new Error("förväntade ok=true");
    expect(line.payerName).toBeNull();
  });
});

describe("deriveExternalId", () => {
  test("deterministisk: samma (fileSha256, lineOrdinal) ger samma nyckel", () => {
    expect(deriveExternalId(FILE_SHA, 3)).toBe(deriveExternalId(FILE_SHA, 3));
  });

  test("olika lineOrdinal ger olika nycklar", () => {
    expect(deriveExternalId(FILE_SHA, 0)).not.toBe(deriveExternalId(FILE_SHA, 1));
  });

  test("olika fileSha256 ger olika nycklar för samma ordinal", () => {
    expect(deriveExternalId(FILE_SHA, 0)).not.toBe(deriveExternalId("b".repeat(64), 0));
  });
});

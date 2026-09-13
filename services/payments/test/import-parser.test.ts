// Enhetstest för det BgMax-LIKNANDE filformatet (förenklat för denna
// övning — se fas 5-planens Kontext-avsnitt punkt 1). Ren funktion, ingen
// DB, ingen I/O.

import { describe, expect, test } from "bun:test";
import { deriveExternalId, parseBgmaxLike } from "../src/import/parser";

describe("parseBgmaxLike", () => {
  test("välformade rader parsas korrekt", () => {
    const text = "1234567|1230172|150000|Björn Borg AB|2026-09-10|BANK-ext-1";
    const [line] = parseBgmaxLike(text);
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
    const lines = parseBgmaxLike(text);
    expect(lines).toHaveLength(2);
  });

  test("saknat OCR -> tom sträng, inte ett radfel (arketypiskt unknown_ocr, PR-granskning #7)", () => {
    const text = "1234567||150000|Björn Borg AB|2026-09-10|ext-1";
    const [line] = parseBgmaxLike(text);
    expect(line?.ok).toBe(true);
    if (!line?.ok) throw new Error("förväntade ok=true");
    expect(line.ocr).toBe("");
  });

  test("saknat bankgiro ger ett radspecifikt fel", () => {
    const text = "|1230172|150000|Björn Borg AB|2026-09-10|ext-1";
    const [line] = parseBgmaxLike(text);
    expect(line?.ok).toBe(false);
    if (line?.ok !== false) throw new Error("förväntade ok=false");
    expect(line.error).toMatch(/bankgiro/);
  });

  test("saknat externalId -> härledd nyckel ur radens egna normaliserade fält", () => {
    const text = "1234567|1230172|150000|Björn Borg AB|2026-09-10|";
    const [line] = parseBgmaxLike(text);
    expect(line?.ok).toBe(true);
    if (!line?.ok) throw new Error("förväntade ok=true");
    expect(line.externalId).toBe(
      deriveExternalId(0, "1234567", "1230172", 150000, "Björn Borg AB", line.bookedAt),
    );
    expect(line.externalId).not.toBe("");
  });

  test("felformad rad (fel antal fält) ger ett radspecifikt fel utan att avbryta filen", () => {
    const text = [
      "1234567|1230172|150000|Björn Borg AB|2026-09-10|ext-1",
      "trasig-rad-med-for-fa-falt|123",
      "7654321|4560283|75000|Elin Persson|2026-09-10|ext-2",
    ].join("\n");
    const lines = parseBgmaxLike(text);
    expect(lines).toHaveLength(3);
    expect(lines[0]?.ok).toBe(true);
    expect(lines[1]?.ok).toBe(false);
    expect(lines[2]?.ok).toBe(true);
    if (lines[1]?.ok !== false) throw new Error("förväntade ok=false");
    expect(lines[1].error).toMatch(/6 fält/);
  });

  test("ogiltigt amountOre ger ett radspecifikt fel", () => {
    const text = "1234567|1230172|noll-kronor|Björn Borg AB|2026-09-10|ext-1";
    const [line] = parseBgmaxLike(text);
    expect(line?.ok).toBe(false);
    if (line?.ok !== false) throw new Error("förväntade ok=false");
    expect(line.error).toMatch(/amountOre/);
  });

  test("negativt eller nollställt amountOre avvisas", () => {
    const text = [
      "1234567|1230172|0|x|2026-09-10|ext-1",
      "1234567|1230172|-100|x|2026-09-10|ext-2",
    ].join("\n");
    const lines = parseBgmaxLike(text);
    expect(lines.every((l) => l.ok === false)).toBe(true);
  });

  test("ogiltigt bookedDate ger ett radspecifikt fel", () => {
    const text = "1234567|1230172|100000|x|inte-ett-datum|ext-1";
    const [line] = parseBgmaxLike(text);
    expect(line?.ok).toBe(false);
    if (line?.ok !== false) throw new Error("förväntade ok=false");
    expect(line.error).toMatch(/bookedDate/);
  });

  test("samma fil parsad två gånger ger identiska härledda nycklar", () => {
    const text = [
      "1234567|1230172|150000|x|2026-09-10|",
      "7654321|4560283|75000|y|2026-09-10|",
    ].join("\n");
    const first = parseBgmaxLike(text);
    const second = parseBgmaxLike(text);
    expect(first.map((l) => (l.ok ? l.externalId : null))).toEqual(
      second.map((l) => (l.ok ? l.externalId : null)),
    );
  });

  test("CRLF i stället för LF ger SAMMA härledda nycklar (PR-granskning fas 5, punkt 8)", () => {
    // En tidigare version hashade filens råa bytes, så bara radbrytnings-
    // tecknet (CRLF kontra LF) — som parsern medvetet är tolerant mot —
    // ändrade nyckeln för varje rad. En semantiskt identisk omexport från
    // banken kunde då bokföras om i stället för att dedupas.
    const lf = ["1234567|1230172|150000|x|2026-09-10|", "7654321|4560283|75000|y|2026-09-10|"].join(
      "\n",
    );
    const crlf = lf.replace(/\n/g, "\r\n");
    const fromLf = parseBgmaxLike(lf);
    const fromCrlf = parseBgmaxLike(crlf);
    expect(fromLf.map((l) => (l.ok ? l.externalId : null))).toEqual(
      fromCrlf.map((l) => (l.ok ? l.externalId : null)),
    );
  });

  test("en extra trailing radbrytning ger SAMMA härledda nycklar för de befintliga raderna", () => {
    const text = "1234567|1230172|150000|x|2026-09-10|";
    const withTrailingNewline = `${text}\n\n\n`;
    const first = parseBgmaxLike(text);
    const second = parseBgmaxLike(withTrailingNewline);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.ok && second[0]?.ok ? first[0].externalId : null).toBe(
      first[0]?.ok && second[0]?.ok ? second[0].externalId : "mismatch",
    );
  });

  test("payerName saknas (tomt fält) -> null, inte tom sträng", () => {
    const text = "1234567|1230172|150000||2026-09-10|ext-1";
    const [line] = parseBgmaxLike(text);
    if (line?.ok !== true) throw new Error("förväntade ok=true");
    expect(line.payerName).toBeNull();
  });
});

describe("deriveExternalId", () => {
  const bookedAt = new Date("2026-09-10T00:00:00.000Z");

  test("deterministisk: samma indata ger samma nyckel", () => {
    expect(deriveExternalId(3, "1234567", "1230172", 100, "x", bookedAt)).toBe(
      deriveExternalId(3, "1234567", "1230172", 100, "x", bookedAt),
    );
  });

  test("olika lineOrdinal ger olika nycklar även med i övrigt identiska fält", () => {
    expect(deriveExternalId(0, "1234567", "1230172", 100, "x", bookedAt)).not.toBe(
      deriveExternalId(1, "1234567", "1230172", 100, "x", bookedAt),
    );
  });

  test("olika belopp ger olika nycklar", () => {
    expect(deriveExternalId(0, "1234567", "1230172", 100, "x", bookedAt)).not.toBe(
      deriveExternalId(0, "1234567", "1230172", 200, "x", bookedAt),
    );
  });
});

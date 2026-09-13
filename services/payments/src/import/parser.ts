// Ren parsning av det BgMax-LIKNANDE formatet (förenklat för denna övning
// — INTE det riktiga Bankgirot-formatet, se fas 5-planens Kontext-avsnitt
// punkt 1). Ingen I/O här, helt enhetstestbar för sig.
//
// Format: en rad per transaktion, pipe-separerad, sex fält:
//   bankgiro|ocr|amountOre|payerName|bookedDate|externalId
// ocr är VALFRITT (tomt tillåtet) — en betalning utan OCR-referens är
// det arketypiska unknown_ocr-fallet, inte ett fel (PR-granskning fas 5,
// punkt 7): matchningsmotorns isValidOcr("") är redan false, så en tom
// sträng landar naturligt i manual_review i stället för att avvisas här.
// bankgiro är obligatoriskt — utan det går transaktionen inte att spåra
// till NÅGON tenant, inte ens driftvyn (som kräver ett faktiskt
// bankgiro-värde att visa).
//
// externalId är sista fältet och VALFRITT (tomt tillåtet): satt ->
// external_id = värdet; tomt -> external_id härleds deterministiskt ur
// radens EGNA, normaliserade fält — se deriveExternalId. Tomma rader
// hoppas över (radbrytnings-robusthet). En felformad rad (fel antal
// fält, eller ogiltigt belopp/datum) ger ett RADSPECIFIKT fel utan att
// avbryta resten av filen — en trasig rad ska inte kunna dölja 999
// giltiga.

import { createHash } from "node:crypto";

export interface ParsedLineOk {
  ok: true;
  lineOrdinal: number;
  bankgiro: string;
  ocr: string;
  amountOre: number;
  payerName: string | null;
  bookedAt: Date;
  externalId: string;
}

export interface ParsedLineError {
  ok: false;
  lineOrdinal: number;
  raw: string;
  error: string;
}

export type ParsedLine = ParsedLineOk | ParsedLineError;

const FIELD_COUNT = 6;

/**
 * Deterministisk härledd id: sha256(lineOrdinal + ':' + radens EGNA
 * normaliserade fält), hex. Hashas ur det PARSADE (trimmade) innehållet,
 * INTE ur filens råa bytes — en tidigare version hashade
 * (fileSha256, lineOrdinal), vilket gjorde nyckeln känslig för
 * radbrytningsformat (CRLF kontra LF) trots att parsern själv är
 * tolerant mot precis den skillnaden. En semantiskt identisk omexport
 * från banken (bara annat radbrytningstecken) gav då NYA nycklar för
 * varje rad — ingen dedup vid en ren formatskillnad, och en delbetalning
 * kunde bokföras om (PR-granskning fas 5, punkt 8). lineOrdinal är kvar
 * i hashen som tiebreaker: två rader med råkat identiska fältvärden i
 * SAMMA fil (skilda verkliga transaktioner) ska ändå få olika nycklar.
 */
export function deriveExternalId(
  lineOrdinal: number,
  bankgiro: string,
  ocr: string,
  amountOre: number,
  payerName: string | null,
  bookedAt: Date,
): string {
  const canonical = [
    bankgiro,
    ocr,
    String(amountOre),
    payerName ?? "",
    bookedAt.toISOString(),
  ].join("|");
  return createHash("sha256").update(`${lineOrdinal}:${canonical}`).digest("hex");
}

function parseOne(raw: string, lineOrdinal: number): ParsedLine {
  const fields = raw.split("|");
  if (fields.length !== FIELD_COUNT) {
    return {
      ok: false,
      lineOrdinal,
      raw,
      error: `förväntade ${FIELD_COUNT} fält, fick ${fields.length}`,
    };
  }
  const [bankgiroRaw, ocrRaw, amountRaw, payerNameRaw, bookedDateRaw, externalIdRaw] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const bankgiro = bankgiroRaw.trim();
  if (!bankgiro) {
    return { ok: false, lineOrdinal, raw, error: "bankgiro krävs" };
  }
  // Tomt tillåtet — se moduldocen ovan. isValidOcr("") är false, så
  // matchningsmotorn landar raden i manual_review/unknown_ocr av sig
  // själv, precis som ett OCR med fel Luhn-siffra.
  const ocr = ocrRaw.trim();

  const amountOre = Number(amountRaw.trim());
  if (!Number.isInteger(amountOre) || amountOre <= 0) {
    return { ok: false, lineOrdinal, raw, error: `ogiltigt amountOre: ${amountRaw}` };
  }

  const bookedDate = bookedDateRaw.trim();
  const bookedAt = new Date(`${bookedDate}T00:00:00.000Z`);
  if (!bookedDate || Number.isNaN(bookedAt.getTime())) {
    return { ok: false, lineOrdinal, raw, error: `ogiltigt bookedDate: ${bookedDateRaw}` };
  }

  const payerName = payerNameRaw.trim() || null;
  const externalId =
    externalIdRaw.trim() ||
    deriveExternalId(lineOrdinal, bankgiro, ocr, amountOre, payerName, bookedAt);

  return { ok: true, lineOrdinal, bankgiro, ocr, amountOre, payerName, bookedAt, externalId };
}

export function parseBgmaxLike(fileText: string): ParsedLine[] {
  const lines = fileText.split(/\r\n|\n/).filter((line) => line.trim().length > 0);
  return lines.map((line, i) => parseOne(line.trim(), i));
}

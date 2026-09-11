// Ren parsning av det BgMax-LIKNANDE formatet (förenklat för denna övning
// — INTE det riktiga Bankgirot-formatet, se fas 5-planens Kontext-avsnitt
// punkt 1). Ingen I/O här, helt enhetstestbar för sig.
//
// Format: en rad per transaktion, pipe-separerad, sex fält:
//   bankgiro|ocr|amountOre|payerName|bookedDate|externalId
// externalId är sista fältet och VALFRITT (tomt tillåtet): satt ->
// external_id = värdet; tomt -> external_id härleds deterministiskt ur
// (fileSha256, lineOrdinal) — se deriveExternalId. Tomma rader hoppas
// över (radbrytnings-robusthet). En felformad rad (fel antal fält, eller
// ogiltigt belopp/datum) ger ett RADSPECIFIKT fel utan att avbryta resten
// av filen — en trasig rad ska inte kunna dölja 999 giltiga.

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
 * Deterministisk härledd id: sha256(fileSha256 + ':' + lineOrdinal), hex
 * — samma stil som hashRequest i services/billing/src/idempotency.ts.
 * Samma fil parsad två gånger ger identiska nycklar (fileSha256 är
 * densamma, lineOrdinal räknas likadant); en ändrad fil ger en annan
 * fileSha256 och alltså andra nycklar — ingen falsk dedup mot en gammal
 * import.
 */
export function deriveExternalId(fileSha256: string, lineOrdinal: number): string {
  return createHash("sha256").update(`${fileSha256}:${lineOrdinal}`).digest("hex");
}

function parseOne(raw: string, lineOrdinal: number, fileSha256: string): ParsedLine {
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
  const ocr = ocrRaw.trim();
  if (!bankgiro || !ocr) {
    return { ok: false, lineOrdinal, raw, error: "bankgiro och ocr krävs" };
  }

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
  const externalId = externalIdRaw.trim() || deriveExternalId(fileSha256, lineOrdinal);

  return { ok: true, lineOrdinal, bankgiro, ocr, amountOre, payerName, bookedAt, externalId };
}

/**
 * fileSha256 ska vara SHA-256 (hex) över HELA filens rå bytes, räknad av
 * anroparen (import/service.ts) — det är vad som gör härledda id:n
 * stabila mot en ordagrant identisk omimport men olika mot en redigerad
 * fil.
 */
export function parseBgmaxLike(fileText: string, fileSha256: string): ParsedLine[] {
  const lines = fileText.split(/\r\n|\n/).filter((line) => line.trim().length > 0);
  return lines.map((line, i) => parseOne(line.trim(), i, fileSha256));
}

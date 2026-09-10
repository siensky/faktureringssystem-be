// Momsberäkning per rad (domain.md #10, preciserad i fas 3):
//   - moms räknas PER RAD och summeras, aldrig på totalen
//   - avrundning sker EN gång, på radnivå, matematiskt halvt uppåt
//     (0,5 öre rundas till 1 öre) — roundHalfUp nedan
//   - totalen är summan av de redan avrundade radbeloppen; ingen
//     öresavrundning av totalen
//
// unitPriceOre är ett HELTAL öre — belopp kommer in i öre vid API-gränsen,
// aldrig som kronor-float (database.md #6). quantity är NUMERIC(12,3): ett
// antal med upp till tre decimaler. Multiplikationen quantity * unitPriceOre
// görs därför i heltalsaritmetik (kvantiteten delas i heltals- och
// tusendelsdel) så att t.ex. 1,115 * 100 öre ger exakt 111,5 -> 112, inte
// 111 pga flyttalsrepresentationen av 1,115.
//
// Kreditfakturor NEGERAR färdigt avrundade radbelopp i stället för att köra
// beräkningen med negativa tal — då slipper vi helt frågan om hur -0,5 ska
// rundas, och en kreditrad speglar exakt sin originalrad.

export type VatRate = 0 | 6 | 12 | 25;
export const VAT_RATES: readonly VatRate[] = [0, 6, 12, 25];

/**
 * Matematisk avrundning halvt uppåt: 0,5 → 1, 1,5 → 2, 2,5 → 3.
 * floor(x + 0,5) är entydigt åt +∞ för alla indata. Radbelopp som når hit
 * är alltid ≥ 0 (se filhuvudet) och långt under 2^52, så x + 0,5 är exakt.
 */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export interface LineInput {
  /** Antal — NUMERIC(12,3), alltså upp till tre decimaler. */
  quantity: number;
  /** Styckpris i heltal öre. */
  unitPriceOre: number;
  vatRate: VatRate;
}

export interface LineAmounts {
  lineExclVatOre: number;
  lineVatOre: number;
  lineInclVatOre: number;
}

/** quantity * unitPriceOre utan flyttalsdrift. Kräver heltal unitPriceOre. */
function exactLineExclVat(quantity: number, unitPriceOre: number): number {
  const milli = Math.round(quantity * 1000); // heltal tusendelar av antalet
  const whole = Math.trunc(milli / 1000);
  const frac = milli - whole * 1000; // -999..999
  const wholePart = whole * unitPriceOre;
  if (!Number.isSafeInteger(wholePart)) {
    throw new Error("Radbeloppet överskrider säkert heltalsintervall — dela upp fakturan");
  }
  // frac * unitPriceOre ≤ 999 * unitPriceOre, alltid säkert med schemats
  // gränser; / 1000 ger k/1000 där halvvägsfallet (k ≡ 500 mod 1000) är
  // exakt representerbart.
  return wholePart + (frac * unitPriceOre) / 1000;
}

/** Räknar ut de tre radbeloppen. Avrundar excl och vat var för sig, en gång. */
export function computeLine(line: LineInput): LineAmounts {
  const lineExclVatOre = roundHalfUp(exactLineExclVat(line.quantity, line.unitPriceOre));
  const lineVatOre = roundHalfUp((lineExclVatOre * line.vatRate) / 100);
  return {
    lineExclVatOre,
    lineVatOre,
    lineInclVatOre: lineExclVatOre + lineVatOre,
  };
}

export interface InvoiceTotals {
  totalExclVatOre: number;
  totalVatOre: number;
  totalInclVatOre: number;
}

/** Summerar redan avrundade radbelopp. Ingen avrundning här. */
export function sumTotals(lines: LineAmounts[]): InvoiceTotals {
  return lines.reduce<InvoiceTotals>(
    (acc, l) => ({
      totalExclVatOre: acc.totalExclVatOre + l.lineExclVatOre,
      totalVatOre: acc.totalVatOre + l.lineVatOre,
      totalInclVatOre: acc.totalInclVatOre + l.lineInclVatOre,
    }),
    { totalExclVatOre: 0, totalVatOre: 0, totalInclVatOre: 0 },
  );
}

/** Negerar färdigt beräknade radbelopp — kreditfakturans radkopia. */
export function negateLine(a: LineAmounts): LineAmounts {
  return {
    lineExclVatOre: -a.lineExclVatOre,
    lineVatOre: -a.lineVatOre,
    lineInclVatOre: -a.lineInclVatOre,
  };
}

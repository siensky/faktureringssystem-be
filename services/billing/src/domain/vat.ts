// Momsberäkning per rad (domain.md #10, preciserad i fas 3):
//   - moms räknas PER RAD och summeras, aldrig på totalen
//   - avrundning sker EN gång, på radnivå, matematiskt halvt uppåt
//     (0,5 öre rundas till 1 öre) — roundHalfUp nedan
//   - totalen är summan av de redan avrundade radbeloppen; ingen
//     öresavrundning av totalen
//
// quantity är NUMERIC (kan vara t.ex. 2,5 timmar), unit_price_ore är ett
// heltal öre. Kreditfakturor NEGERAR färdigt avrundade radbelopp i stället
// för att köra beräkningen med negativa tal — då slipper vi helt frågan om
// hur -0,5 ska rundas, och en kreditrad speglar exakt sin originalrad.

export type VatRate = 0 | 6 | 12 | 25;
export const VAT_RATES: readonly VatRate[] = [0, 6, 12, 25];

/**
 * Matematisk avrundning halvt uppåt: 0,5 → 1, 1,5 → 2, 2,5 → 3.
 * `Math.round` i JS gör redan detta för positiva tal, men floor(x + 0,5) är
 * entydigt åt samma håll (mot +∞) för alla indata och lämnar inget tvivel
 * om halvvägsfallet. Radbelopp som når hit är alltid ≥ 0 (se filhuvudet).
 */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export interface LineInput {
  /** Antal — NUMERIC, inte pengar. */
  quantity: number;
  unitPriceOre: number;
  vatRate: VatRate;
}

export interface LineAmounts {
  lineExclVatOre: number;
  lineVatOre: number;
  lineInclVatOre: number;
}

/** Räknar ut de tre radbeloppen. Avrundar excl och vat var för sig, en gång. */
export function computeLine(line: LineInput): LineAmounts {
  const lineExclVatOre = roundHalfUp(line.quantity * line.unitPriceOre);
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

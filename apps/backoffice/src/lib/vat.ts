// Speglar services/billing/src/domain/vat.ts (roundHalfUp + computeLine)
// exakt, i öre, så att live-summeringen i InvoiceFormPage visar samma
// belopp som backend faktiskt bokför. Duplicerad snarare än delad — frontend
// importerar inte backend-källkod (samma gräns som gör att packages/contracts
// har handskrivna REST-typer i stället för kod delad rakt av).
//
// domain.md #10: moms räknas PER RAD, avrundas EN gång (matematiskt halvt
// uppåt), och totalen är summan av redan avrundade radbelopp.

export type VatRate = 0 | 6 | 12 | 25;

/** Matematisk avrundning halvt uppåt: 0,5 → 1, 1,5 → 2. */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/** quantity * unitPriceOre utan flyttalsdrift (samma uppdelning som backend). */
function exactLineExclVatOre(quantity: number, unitPriceOre: number): number {
  const milli = Math.round(quantity * 1000);
  const whole = Math.trunc(milli / 1000);
  const frac = milli - whole * 1000;
  return whole * unitPriceOre + (frac * unitPriceOre) / 1000;
}

export interface LineAmountsOre {
  lineExclVatOre: number;
  lineVatOre: number;
  lineInclVatOre: number;
}

export function computeLineOre(
  quantity: number,
  unitPriceOre: number,
  vatRate: VatRate,
): LineAmountsOre {
  const lineExclVatOre = roundHalfUp(exactLineExclVatOre(quantity, unitPriceOre));
  const lineVatOre = roundHalfUp((lineExclVatOre * vatRate) / 100);
  return { lineExclVatOre, lineVatOre, lineInclVatOre: lineExclVatOre + lineVatOre };
}

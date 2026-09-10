// OCR-referensnummer härlett ur fakturanumret (planens Domänmodell #5):
//   ocr = <fakturanummer> <längdsiffra> <Luhn-kontrollsiffra>
// Längdsiffran = (antal siffror inklusive längd- och kontrollsiffra) mod 10.
// Eftersom fakturanumret redan är unikt och obrutet per tenant är en
// OCR-kollision omöjlig per konstruktion — ingen omgenerering behövs.
//
// OCR är därmed FÖRUTSÄGBART. Det är ofarligt (numret står tryckt på
// fakturan) men får aldrig användas som identitetsbevis — portalens
// åtkomstkontroll går på tenant + kund, aldrig på OCR (domain.md).

function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let double = true; // börja dubbla från höger (siffran prectis vänster om kontrollsiffran)
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

export function deriveOcr(invoiceNumber: number): string {
  if (!Number.isInteger(invoiceNumber) || invoiceNumber <= 0) {
    throw new Error(`Ogiltigt fakturanummer för OCR: ${invoiceNumber}`);
  }
  const base = String(invoiceNumber);
  const lengthDigit = String((base.length + 2) % 10);
  const withLength = base + lengthDigit;
  return withLength + String(luhnCheckDigit(withLength));
}

/** Validerar ett OCR (längdsiffra + Luhn). Används av payments i fas 5. */
export function isValidOcr(ocr: string): boolean {
  if (!/^\d{3,}$/.test(ocr)) return false;
  const body = ocr.slice(0, -1);
  const check = Number(ocr.slice(-1));
  const base = body.slice(0, -1);
  const lengthDigit = Number(body.slice(-1));
  if ((base.length + 2) % 10 !== lengthDigit) return false;
  return luhnCheckDigit(body) === check;
}

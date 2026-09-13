// Kanonisering och validering av svenska identifierare. Bor i shared så att
// auth och billing INTE kan glida isär: BankID returnerar personnumret som
// 12 siffror (YYYYMMDDNNNC) och det är den formen allt annat normaliserar
// till, så users.pnr_hash (auth) och customers.pnr_hmac (billing) alltid
// hashar samma sträng för samma person (se domain.md #20, planens
// Personnummer-avsnitt).

import { BadRequest } from "../errors";

/** Luhn mod-10-kontroll (kontrollsiffran är sista siffran i strängen). */
export function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Kanoniserar ett personnummer till 12 siffror (YYYYMMDDNNNC). Tar emot
 * 10- eller 12-siffriga former med valfritt `-`/`+`-separator och
 * blanksteg. Ett `+` betyder att personen fyllt 100 (sekelskifte bakåt).
 * Kastar BadRequest om formen inte går att tyda — validerar INTE
 * kontrollsiffra eller datum (det gör isValidPnr).
 */
export function normalizePnr(input: string): string {
  const raw = input.trim();
  const isCentenarian = /\+/.test(raw);
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 12) return digits;
  if (digits.length !== 10) {
    throw new BadRequest("Personnummer måste vara 10 eller 12 siffror");
  }

  const yy = Number(digits.slice(0, 2));
  const currentYear = new Date().getUTCFullYear();
  let year = Math.floor(currentYear / 100) * 100 + yy;
  if (year > currentYear) year -= 100;
  if (isCentenarian) year -= 100;
  return String(year).padStart(4, "0") + digits.slice(2);
}

/** Fullständig kontroll: kanoniserbar + Luhn + rimligt datum (även samordningsnummer). */
export function isValidPnr(input: string): boolean {
  let d: string;
  try {
    d = normalizePnr(input);
  } catch {
    return false;
  }
  if (!luhn(d.slice(2))) return false;

  const month = Number(d.slice(4, 6));
  let day = Number(d.slice(6, 8));
  if (day > 60) day -= 60; // samordningsnummer
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** Organisationsnummer: 10 siffror, Luhn mod-10. */
export function isValidOrgNumber(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  return digits.length === 10 && luhn(digits);
}

/** Bankgironummer: 7 eller 8 siffror, Luhn mod-10. */
export function isValidBankgiro(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  return (digits.length === 7 || digits.length === 8) && luhn(digits);
}

/**
 * Kanoniserar ett bankgironummer till rena siffror (inga bindestreck/
 * mellanslag). Bor i shared av samma skäl som normalizePnr: billing
 * (skriver company_settings.bankgiro) och payments (slår upp och
 * lagrar bank_transactions.bankgiro) måste normalisera EXAKT likadant,
 * annars kan två tenants skriva samma bankgiro i olika format och båda
 * smyga förbi det partiella unika indexet på company_settings.bankgiro
 * (PR-granskning fas 5, punkt 1 — "5555-5555" och "55555555" ansågs
 * olika strängar och kolliderade aldrig, men matchade heller aldrig en
 * inkommande betalnings rena sifferform).
 */
export function normalizeBankgiro(input: string): string {
  return input.replace(/\D/g, "");
}

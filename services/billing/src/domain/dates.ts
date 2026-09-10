// Affärsdatum tolkas i Europe/Stockholm, inte UTC (database.md #11).
// "Förfallen idag" och fakturadatum avgörs i svensk tid.

const STOCKHOLM = "Europe/Stockholm";

/** Dagens datum i svensk tid som 'YYYY-MM-DD'. */
export function todayInStockholm(now: Date = new Date()): string {
  // en-CA ger ISO-formatet YYYY-MM-DD direkt.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STOCKHOLM,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Lägger n dygn till ett 'YYYY-MM-DD'-datum. Rent kalenderdatum, ingen tid. */
export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  // UTC-midnatt undviker att DST förskjuter datumet vid addition.
  const base = Date.UTC(y as number, (m as number) - 1, d as number);
  const shifted = new Date(base + n * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

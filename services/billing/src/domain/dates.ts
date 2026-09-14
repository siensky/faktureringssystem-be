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

export type RecurrenceInterval = "monthly" | "quarterly" | "yearly";

const MONTHS_PER_INTERVAL: Record<RecurrenceInterval, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * Lägger till en period (fas 6: invoice_templates.interval) på ett
 * 'YYYY-MM-DD'-datum. Ren kalendermånadsräkning, ingen DST-påverkan (det är
 * bara addDays/klockslag som DST rör vid) — men månadslängden varierar, så
 * dagen KLAMPAS till sista giltiga dagen i målmånaden i stället för att
 * "spilla över" till nästa (31 jan + 1 månad -> 28/29 feb, inte 2/3 mars).
 *
 * `billingDay` är mallens URSPRUNGLIGA, ALDRIG klampade ankardygn
 * (invoice_templates.billing_day, migrations/0007) — INTE dagen ur
 * `isoDate`. Klampar man i stället mot förra periodens (kanske redan
 * klampade) `isoDate` drar mallen permanent iväg: 31 jan -> 28 feb (rätt) ->
 * 28 mar (FEL, mars har 31 dagar och borde återhämta ankardygnet) i stället
 * för 31 mar. Genom att alltid klampa mot samma ursprungliga `billingDay`
 * återhämtar en lång månad automatiskt dagen en kort månad tvingade bort
 * (kodgranskning PR #6, fynd 3).
 */
export function advanceByInterval(
  isoDate: string,
  interval: RecurrenceInterval,
  billingDay: number,
): string {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const totalMonths = m - 1 + MONTHS_PER_INTERVAL[interval];
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1; // 1-12
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(billingDay, lastDayOfTargetMonth);
  const mm = String(targetMonth).padStart(2, "0");
  const dd = String(targetDay).padStart(2, "0");
  return `${targetYear}-${mm}-${dd}`;
}

// invoices.date_issued/date_due är DATE-kolumner, men postgres.js parsar dem
// till JS Date och Fastify serialiserar Date som full ISO-sträng
// ("2026-09-16T00:00:00.000Z") — inte "YYYY-MM-DD" (befintligt API-beteende,
// inte infört i fas 8). Datumdelen är alltid UTC-midnatt, så en enkel slice
// är trygg och krävs dessutom av <input type="date">, som bara accepterar
// "YYYY-MM-DD".
export function toDateOnly(value: string): string {
  return value.slice(0, 10);
}

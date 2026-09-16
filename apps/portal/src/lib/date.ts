// Samma mönster som apps/backoffice/src/lib/date.ts — se den filens
// kommentar för varför en enkel slice är trygg här.
export function toDateOnly(value: string): string {
  return value.slice(0, 10);
}

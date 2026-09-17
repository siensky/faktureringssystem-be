// API:t returnerar redan kronor (backend konverterar öre -> kronor sist,
// database.md #8) — portalen är helt läsande och räknar aldrig själv öre.

export function formatSEK(kronor: number): string {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" }).format(kronor);
}

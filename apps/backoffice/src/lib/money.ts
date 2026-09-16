// API:t returnerar redan kronor (backend konverterar öre -> kronor sist,
// database.md #8). Enda stället frontend själv räknar öre är fakturaformuläret,
// som skickar unitPriceOre (HELTAL öre, database.md #6) till POST/PUT.

export function kronorToOre(kronor: number): number {
  return Math.round(kronor * 100);
}

export function formatSEK(kronor: number): string {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" }).format(kronor);
}

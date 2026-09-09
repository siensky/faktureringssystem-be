// postgres.js-klienten, flyttad från src/db/db.ts. Samma bibliotek som
// tidigare — bara omgjort till en fabrik i stället för en modul-singleton,
// så varje tjänst skapar sin egen anslutningspool med sin egen
// DATABASE_URL i stället för att alla tjänster råkar dela en modul-cache.

import postgres, { type Sql } from "postgres";

export interface DbClientOptions {
  /** Max antal anslutningar i poolen. postgres.js default är 10. */
  max?: number;
}

export function createDbClient(connectionString: string, options: DbClientOptions = {}): Sql {
  return postgres(connectionString, {
    max: options.max ?? 10,
    // Belopp är alltid BIGINT i öre (database.md #6) — postgres.js
    // returnerar DECIMAL som sträng, men vi ska aldrig ha DECIMAL för
    // pengar i första läget. quantity/vat_rate (NUMERIC) kommer som sträng,
    // vilket är korrekt: de rundas aldrig till float i onödan.
  });
}

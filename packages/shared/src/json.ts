// JSON-säkra typer för payloads som ska ner i jsonb-kolumner via
// postgres.js sql.json(). Record<string, unknown> duger inte — postgres.js
// JSONValue-typ accepterar inte `unknown` som värde.

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

// Env-validering som kraschar tidigt vid saknad config (fas 0, se PLAN.md).
// Varje tjänst listar de miljövariabler den kräver för att starta; saknas
// någon kastas ett fel direkt vid uppstart i stället för att tjänsten
// startar och kraschar oförklarligt på första request som råkar behöva
// variabeln. code-style.md #26: konfiguration läses en gång vid uppstart
// och valideras, ingen process.env utspridd i affärslogiken.

export class MissingEnvError extends Error {
  constructor(public readonly missingKeys: string[]) {
    super(`Saknade miljövariabler: ${missingKeys.join(", ")}`);
    this.name = "MissingEnvError";
  }
}

/**
 * Läser en lista med miljövariabelnamn ur `source` (default process.env) och
 * returnerar dem som ett objekt med samma nycklar. Kastar MissingEnvError om
 * någon saknas eller är en tom sträng — en explicit tom sträng räknas som
 * "inte satt", inte som ett giltigt värde.
 */
export function loadEnv<T extends readonly string[]>(
  keys: T,
  source: NodeJS.ProcessEnv = process.env,
): Record<T[number], string> {
  const missing: string[] = [];
  const result = {} as Record<T[number], string>;

  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === "") {
      missing.push(key);
      continue;
    }
    result[key as T[number]] = value;
  }

  if (missing.length > 0) {
    throw new MissingEnvError(missing);
  }

  return result;
}

/** Som loadEnv, men med ett fallback-värde per nyckel i stället för att kasta. */
export function loadEnvWithDefaults<T extends Record<string, string>>(
  defaults: T,
  source: NodeJS.ProcessEnv = process.env,
): T {
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = source[key as string];
    if (value !== undefined && value !== "") {
      result[key] = value as T[keyof T];
    }
  }
  return result;
}

/** Tolkar ett env-värde som heltal, kastar tydligt om det inte går. */
export function parseIntEnv(name: string, value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Miljövariabeln ${name} måste vara ett heltal, fick "${value}"`);
  }
  return parsed;
}

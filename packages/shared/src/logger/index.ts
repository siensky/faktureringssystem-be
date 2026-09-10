// Strukturerad loggning (pino) med en maskeringsregel som täcker
// personnummer, lösenord och tokens — den måste sitta innan första riktiga
// datat loggas (fas 0, se PLAN.md). domain.md #19: detta loggas ALDRIG,
// inte i strukturerade loggar, felmeddelanden, URL:er eller stack traces.
//
// Detta är ett skyddsnät, inte en ursäkt för att slarva: rules säger själva
// "lita inte på att den fångar allt utan tänk efter innan du loggar ett
// helt objekt".
//
// Maskeringen sker rekursivt på FÄLTNAMN, på valfritt djup. pinos inbyggda
// `redact.paths` klarar bara `*` som ETT mellanled (`*.password` träffar
// `a.password` men inte `a.b.password`), så en `formatters.log`-hook som
// går igenom hela objektet används i stället — samma beteende som
// structlog-maskeringen på Python-sidan (services/documents).

import pino, { type Logger, type LoggerOptions } from "pino";

/** Fältnamn (gemener) vars värde alltid maskeras, oavsett var i objektet. */
const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "clientsecret",
  "authorization",
  "cookie",
  "pnr",
  "personnummer",
  "pnrhash",
  "pnrhmac",
  "pnrencrypted",
  "resettoken",
  "signedurl",
]);

const CENSOR = "[REDACTED]";
const MAX_DEPTH = 8;

export function deepRedact(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === null || typeof value !== "object" || depth > MAX_DEPTH) {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => deepRedact(item, seen, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? CENSOR : deepRedact(val, seen, depth + 1);
  }
  return out;
}

export { SENSITIVE_KEYS };

export function createLogger(
  serviceName: string,
  options: LoggerOptions = {},
  destination?: pino.DestinationStream,
): Logger {
  return pino(
    {
      name: serviceName,
      level: process.env.LOG_LEVEL ?? "info",
      formatters: {
        log: (object) => deepRedact(object) as Record<string, unknown>,
      },
      ...options,
    },
    destination,
  );
}

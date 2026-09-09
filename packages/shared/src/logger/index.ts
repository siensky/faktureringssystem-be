// Strukturerad loggning (pino) med en maskeringsregel som täcker
// personnummer, lösenord och tokens — den måste sitta innan första riktiga
// datat loggas (fas 0, se PLAN.md). domain.md #19: detta loggas ALDRIG,
// inte i strukturerade loggar, felmeddelanden, URL:er eller stack traces.
//
// Detta är ett skyddsnät, inte en ursäkt för att slarva: rules säger själva
// "lita inte på att den fångar allt utan tänk efter innan du loggar ett
// helt objekt". Redact-listan täcker kända fältnamn på valfritt djup.

import pino, { type Logger, type LoggerOptions } from "pino";

const REDACT_PATHS = [
  // HTTP
  "req.headers.authorization",
  "req.headers.cookie",
  "*.headers.authorization",
  "*.headers.cookie",
  // Lösenord
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  // Tokens och hemligheter
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "idToken",
  "*.idToken",
  "clientSecret",
  "*.clientSecret",
  "authorization",
  "*.authorization",
  // Personnummer (klartext, hash eller krypterat — allt maskeras, ingen
  // anledning att någonsin behöva se ens hashen i en logg)
  "pnr",
  "*.pnr",
  "personnummer",
  "*.personnummer",
  "pnrHash",
  "*.pnrHash",
  "pnrHmac",
  "*.pnrHmac",
  "pnrEncrypted",
  "*.pnrEncrypted",
  // Återställnings- och inbjudningslänkar, signerade URL:er (domain.md #19)
  "resetToken",
  "*.resetToken",
  "signedUrl",
  "*.signedUrl",
];

export { REDACT_PATHS };

export function createLogger(
  serviceName: string,
  options: LoggerOptions = {},
  destination?: pino.DestinationStream,
): Logger {
  return pino(
    {
      name: serviceName,
      level: process.env.LOG_LEVEL ?? "info",
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      ...options,
    },
    destination,
  );
}

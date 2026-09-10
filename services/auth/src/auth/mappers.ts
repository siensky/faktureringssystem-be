// Översättning mellan interna värden och API-form. I auth-modulen är
// svaren små; det mesta är token-par och generiska kvitton.

import type { TokenPair } from "./types";

export function toTokenPairResponse(pair: TokenPair) {
  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresIn: pair.expiresIn,
    tokenType: "Bearer" as const,
  };
}

/** Generiskt kvitto — används där svaret inte får skvallra om utfallet. */
export const OK = { status: "ok" as const };

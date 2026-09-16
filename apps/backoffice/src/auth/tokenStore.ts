// Access-token hålls i minnet (försvinner vid reload — ersätts av ett
// refresh-anrop). Refresh-token i localStorage så inloggningen överlever
// en reload. client.ts (utanför React-trädet) läser/skriver via de här
// funktionerna i stället för att gå via context.

const REFRESH_TOKEN_KEY = "backoffice.refreshToken";

let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(REFRESH_TOKEN_KEY, token);
    else localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Privat läge/blockerad storage — sessionen håller ändå för fliken.
  }
}

export function clearTokens(): void {
  setAccessToken(null);
  setRefreshToken(null);
}

/** AuthContext registrerar sig här för att bli informerad om en 401 som
 *  ett lyckat refresh-försök inte kunde rädda (utloggad, revokerad session). */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

export function notifySessionExpired(): void {
  onSessionExpired?.();
}

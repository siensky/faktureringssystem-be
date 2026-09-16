// Fetch-wrapper mot nginx (planens "nginx som enda publika ingång" —
// tjänsterna nås aldrig direkt från frontend). Bär access-token, försöker
// en gång att förnya den på 401, och kastar ApiError med backendens
// svenska felmeddelande vid fel (packages/shared BaseError.toPublicError()).

import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  notifySessionExpired,
  setAccessToken,
  setRefreshToken,
} from "../auth/tokenStore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Se planens idempotens-regel #3: genereras när formuläret/knappen ÖPPNAS. */
  idempotencyKey?: string;
}

interface PublicErrorBody {
  success: false;
  code: number;
  message: string;
}

function rawRequest(path: string, opts: RequestOptions): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return fetch(`${API_BASE_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { accessToken: string; refreshToken: string };
  setAccessToken(data.accessToken);
  setRefreshToken(data.refreshToken);
  return true;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await rawRequest(path, opts);

  if (res.status === 401 && getRefreshToken() && (await tryRefresh())) {
    res = await rawRequest(path, opts);
  }
  if (res.status === 401) {
    clearTokens();
    notifySessionExpired();
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as PublicErrorBody | null;
    throw new ApiError(res.status, body?.message ?? `Något gick fel (HTTP ${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

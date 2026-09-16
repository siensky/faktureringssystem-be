// Regressionstest för code review-fynd #1: två samtidiga 401:or fick
// tidigare båda anropa POST /auth/refresh var för sig med samma (engångs-,
// roterande) refresh-token — det andra anropet tolkas av auth-tjänsten som
// stöld och avslutar ALLA sessionens tokens (services/auth/src/auth/
// services.ts: "Token återanvänt — alla sessioner avslutade"). Fixen delar
// en in-flight-promise (client.ts:s tryRefresh) så bara ETT anrop någonsin
// skickar ett givet refresh-token.

import { beforeEach, expect, test } from "bun:test";

// bun:test har ingen DOM — tokenStore.ts:s localStorage-anrop behöver en
// minimal shim (get/set/remove räcker, ingen riktig Storage-kontraktstrogenhet).
const store = new Map<string, string>();
// any här: det här är en minimal test-shim, inte en riktig Storage-instans.
(globalThis as any).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

import { apiRequest } from "../src/api/client";
import { setAccessToken, setRefreshToken, setSessionExpiredHandler } from "../src/auth/tokenStore";

let refreshCalls = 0;
const dataCallCounts = new Map<string, number>();

function mockFetch(url: string): Promise<Response> {
  if (url.endsWith("/auth/refresh")) {
    refreshCalls++;
    return Promise.resolve(
      Response.json({ accessToken: "new-access", refreshToken: "new-refresh" }, { status: 200 }),
    );
  }
  const path = new URL(url).pathname;
  const callNumber = (dataCallCounts.get(path) ?? 0) + 1;
  dataCallCounts.set(path, callNumber);
  if (callNumber === 1) {
    // Access-token har gått ut — precis som en riktig 401 från requireUser().
    return Promise.resolve(
      Response.json({ success: false, code: 401, message: "Unauthorized" }, { status: 401 }),
    );
  }
  return Promise.resolve(Response.json({ ok: true, path }, { status: 200 }));
}

beforeEach(() => {
  refreshCalls = 0;
  dataCallCounts.clear();
  store.clear();
  setAccessToken(null);
  setRefreshToken("initial-refresh-token");
  setSessionExpiredHandler(null);
  globalThis.fetch = mockFetch as typeof fetch;
});

test("två samtidiga 401:or delar EN /auth/refresh, inte en var", async () => {
  const [a, b] = await Promise.all([apiRequest("/data/a"), apiRequest("/data/b")]);

  expect(refreshCalls).toBe(1);
  expect(a).toEqual({ ok: true, path: "/data/a" });
  expect(b).toEqual({ ok: true, path: "/data/b" });
});

test("en enskild 401 förnyar också korrekt (regression mot dubbel-fix)", async () => {
  const result = await apiRequest("/data/solo");
  expect(refreshCalls).toBe(1);
  expect(result).toEqual({ ok: true, path: "/data/solo" });
});

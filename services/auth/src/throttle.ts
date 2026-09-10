// Per-konto strypning av inloggning (planens "Rate limiting från och med
// auth-fasen"). Redis-räknare per e-post med exponentiellt växande
// utlåsning — per-IP i nginx stoppar inte credential stuffing spritt över
// många IP:n.
//
// Två nycklar: en räknare för misslyckade försök, och — när räknaren
// passerar tröskeln — en separat lockout-nyckel vars TTL är själva
// utlåsningstiden. assertNotLockedOut behöver då bara kolla om
// lockout-nyckeln finns.

import { TooManyRequests } from "@faktura/shared";
import type Redis from "ioredis";

const THRESHOLD = 5;
const BASE_LOCKOUT_SECONDS = 30;
const MAX_LOCKOUT_SECONDS = 15 * 60;
const COUNTER_TTL_SECONDS = 60 * 60;

const counterKey = (email: string) => `auth:login-fail:${email.toLowerCase()}`;
const lockoutKey = (email: string) => `auth:login-lock:${email.toLowerCase()}`;

export async function assertNotLockedOut(redis: Redis, email: string): Promise<void> {
  if (await redis.exists(lockoutKey(email))) {
    throw new TooManyRequests("För många misslyckade inloggningsförsök, försök igen senare");
  }
}

export async function recordLoginFailure(redis: Redis, email: string): Promise<void> {
  const key = counterKey(email);
  const failures = await redis.incr(key);
  await redis.expire(key, COUNTER_TTL_SECONDS);

  if (failures >= THRESHOLD) {
    const overshoot = failures - THRESHOLD;
    const lockout = Math.min(BASE_LOCKOUT_SECONDS * 2 ** overshoot, MAX_LOCKOUT_SECONDS);
    await redis.set(lockoutKey(email), "1", "EX", lockout);
  }
}

export async function clearLoginFailures(redis: Redis, email: string): Promise<void> {
  await redis.del(counterKey(email), lockoutKey(email));
}

// ── Enkel windowed rate-limit (för t.ex. BankID-init som är en kostnadsyta
//    snarare än en gissningsyta) ──────────────────────────────────────────

const INIT_WINDOW_SECONDS = 60;
const INIT_MAX_PER_WINDOW = 10;

export async function assertInitRate(redis: Redis, scopeKey: string): Promise<void> {
  const key = `auth:init-rate:${scopeKey}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, INIT_WINDOW_SECONDS);
  if (n > INIT_MAX_PER_WINDOW) {
    throw new TooManyRequests("För många försök, försök igen om en stund");
  }
}

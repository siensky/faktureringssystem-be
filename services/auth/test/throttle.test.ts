import { beforeEach, describe, expect, test } from "bun:test";
import { TooManyRequests } from "@faktura/shared";
import type Redis from "ioredis";
import {
  assertInitRate,
  assertNotLockedOut,
  clearLoginFailures,
  recordLoginFailure,
} from "../src/throttle";

// Minimal in-memory Redis-fake — bara det throttle.ts använder.
class FakeRedis {
  private store = new Map<string, string>();
  async incr(k: string): Promise<number> {
    const n = Number(this.store.get(k) ?? 0) + 1;
    this.store.set(k, String(n));
    return n;
  }
  async expire(_k: string, _s: number): Promise<number> {
    return 1;
  }
  async exists(k: string): Promise<number> {
    return this.store.has(k) ? 1 : 0;
  }
  async set(k: string, v: string): Promise<"OK"> {
    this.store.set(k, v);
    return "OK";
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }
}

const redis = () => new FakeRedis() as unknown as Redis;

describe("login-strypning", () => {
  let r: ReturnType<typeof redis>;
  beforeEach(() => {
    r = redis();
  });

  test("inte utlåst från början", async () => {
    await expect(assertNotLockedOut(r, "a@b.test")).resolves.toBeUndefined();
  });

  test("låser efter 5 misslyckade försök", async () => {
    for (let i = 0; i < 4; i++) await recordLoginFailure(r, "a@b.test");
    await expect(assertNotLockedOut(r, "a@b.test")).resolves.toBeUndefined();
    await recordLoginFailure(r, "a@b.test"); // #5 -> lockout
    await expect(assertNotLockedOut(r, "a@b.test")).rejects.toThrow(TooManyRequests);
  });

  test("clearLoginFailures häver låset", async () => {
    for (let i = 0; i < 6; i++) await recordLoginFailure(r, "a@b.test");
    await expect(assertNotLockedOut(r, "a@b.test")).rejects.toThrow();
    await clearLoginFailures(r, "a@b.test");
    await expect(assertNotLockedOut(r, "a@b.test")).resolves.toBeUndefined();
  });
});

describe("assertInitRate (windowed)", () => {
  test("släpper igenom upp till taket, kastar sedan", async () => {
    const r = redis();
    for (let i = 0; i < 10; i++) await assertInitRate(r, "k");
    await expect(assertInitRate(r, "k")).rejects.toThrow(TooManyRequests);
  });

  test("olika nycklar räknas var för sig", async () => {
    const r = redis();
    for (let i = 0; i < 10; i++) await assertInitRate(r, "k1");
    await expect(assertInitRate(r, "k2")).resolves.toBeUndefined();
  });
});

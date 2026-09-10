import { describe, expect, test } from "bun:test";
import { generateToken, hashPassword, hashToken, verifyPassword } from "../src/passwords";

const PEPPER = "00000000000000000000000000000000000000000000000000000000000000aa";

describe("hashPassword / verifyPassword (argon2id via Bun.password)", () => {
  test("verifierar rätt lösenord", async () => {
    const hash = await hashPassword("korrekt-häst-batteri-häftklammer");
    expect(await verifyPassword("korrekt-häst-batteri-häftklammer", hash)).toBe(true);
  });

  test("avvisar fel lösenord", async () => {
    const hash = await hashPassword("korrekt-häst-batteri-häftklammer");
    expect(await verifyPassword("fel-lösenord-helt-annat", hash)).toBe(false);
  });

  test("hash är argon2id och saltas olika varje gång", async () => {
    const a = await hashPassword("samma-lösenord-1234");
    const b = await hashPassword("samma-lösenord-1234");
    expect(a).toStartWith("$argon2id$");
    expect(a).not.toBe(b);
  });
});

describe("generateToken / hashToken", () => {
  test("generateToken ger unika, url-säkra värden", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(seen.size).toBe(200);
    for (const t of seen) expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("hashToken är deterministisk för samma token+peppar", () => {
    expect(hashToken("abc123", PEPPER)).toBe(hashToken("abc123", PEPPER));
  });

  test("hashToken skiljer på olika tokens", () => {
    expect(hashToken("abc123", PEPPER)).not.toBe(hashToken("abc124", PEPPER));
  });
});

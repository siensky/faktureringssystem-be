import { describe, expect, test } from "bun:test";
import { USER_TOKEN, signAccessToken, verifyAccessToken } from "../src/auth";

const SECRET = "test-user-secret-0123456789-0123456789";
const OTHER = "a-different-secret-9876543210-9876543210";
const claims = { userId: 42, tenantId: 7, role: "admin" as const };

describe("access-token", () => {
  test("verifierar ett nyss signerat token och returnerar claims", async () => {
    const token = await signAccessToken(claims, SECRET);
    const out = await verifyAccessToken(token, SECRET);
    expect(out).toEqual(claims);
  });

  test("avvisar token signerat med annan hemlighet", async () => {
    const token = await signAccessToken(claims, OTHER);
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow();
  });

  test("avvisar token med fel token_type (t.ex. ett tjänste-token)", async () => {
    const { SignJWT } = await import("jose");
    const forged = await new SignJWT({ tenantId: 7, role: "admin", token_type: "internal" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("42")
      .setIssuer(USER_TOKEN.issuer)
      .setAudience(USER_TOKEN.audience)
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyAccessToken(forged, SECRET)).rejects.toThrow(/token-typ/i);
  });

  test("avvisar token med fel audience", async () => {
    const { SignJWT } = await import("jose");
    const forged = await new SignJWT({ tenantId: 7, role: "admin", token_type: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("42")
      .setIssuer(USER_TOKEN.issuer)
      .setAudience("internal")
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyAccessToken(forged, SECRET)).rejects.toThrow();
  });

  test("avvisar token med alg: none (algoritmen pinnas)", async () => {
    // Ett osignerat 'alg: none'-token: header.payload. (två segment + tom sig)
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        sub: "42",
        tenantId: 7,
        role: "admin",
        token_type: "access",
        iss: USER_TOKEN.issuer,
        aud: USER_TOKEN.audience,
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString("base64url");
    await expect(verifyAccessToken(`${header}.${body}.`, SECRET)).rejects.toThrow();
  });

  test("avvisar utgånget token", async () => {
    const { SignJWT } = await import("jose");
    const expired = await new SignJWT({ tenantId: 7, role: "admin", token_type: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("42")
      .setIssuer(USER_TOKEN.issuer)
      .setAudience(USER_TOKEN.audience)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyAccessToken(expired, SECRET)).rejects.toThrow();
  });
});

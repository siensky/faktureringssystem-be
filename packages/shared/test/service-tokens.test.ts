import { describe, expect, test } from "bun:test";
import {
  SERVICE_TOKEN,
  assertScope,
  signAccessToken,
  signServiceToken,
  verifyAccessToken,
  verifyServiceToken,
} from "../src/auth";
import { Forbidden } from "../src/errors";

const USER_SECRET = "user-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SERVICE_SECRET = "service-secret-bbbbbbbbbbbbbbbbbbbbbbbb";

describe("tjänste-token", () => {
  test("verifierar ett nyss signerat token och returnerar clientId + scopes", async () => {
    const token = await signServiceToken(
      { clientId: "billing", scope: "billing:invoice:read auth:tenant:read" },
      SERVICE_SECRET,
    );
    const out = await verifyServiceToken(token, SERVICE_SECRET);
    expect(out.clientId).toBe("billing");
    expect(out.scopes).toEqual(["billing:invoice:read", "auth:tenant:read"]);
  });

  test("tjänste-token avvisas av verifyAccessToken (fel dörr)", async () => {
    const svc = await signServiceToken({ clientId: "billing", scope: "x" }, SERVICE_SECRET);
    // Även med SAMMA hemlighet ska aud/token_type stoppa det.
    await expect(verifyAccessToken(svc, SERVICE_SECRET)).rejects.toThrow();
  });

  test("användar-token avvisas av verifyServiceToken (fel dörr)", async () => {
    const user = await signAccessToken({ userId: 1, tenantId: 1, role: "admin" }, USER_SECRET);
    await expect(verifyServiceToken(user, USER_SECRET)).rejects.toThrow();
  });

  test("tjänste-token signerat med annan hemlighet avvisas", async () => {
    const token = await signServiceToken({ clientId: "billing", scope: "x" }, "helt-annan");
    await expect(verifyServiceToken(token, SERVICE_SECRET)).rejects.toThrow();
  });

  test("token utan scope ger tom scope-lista", async () => {
    const token = await signServiceToken({ clientId: "cron", scope: "" }, SERVICE_SECRET);
    expect((await verifyServiceToken(token, SERVICE_SECRET)).scopes).toEqual([]);
  });

  test("TTL är 5 minuter", () => {
    expect(SERVICE_TOKEN.ttlSeconds).toBe(300);
  });
});

describe("assertScope", () => {
  test("passerar när scopet finns", () => {
    expect(() => assertScope(["a", "b"], "b")).not.toThrow();
  });
  test("kastar Forbidden när scopet saknas", () => {
    expect(() => assertScope(["a", "b"], "c")).toThrow(Forbidden);
  });
});

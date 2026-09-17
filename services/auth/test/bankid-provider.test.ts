import { describe, expect, test } from "bun:test";
import { MockBankIdProvider, RealBankIdProvider, computeQrCode } from "../src/bankid/provider";

// Minimal in-memory Redis-fake — bara det MockBankIdProvider använder.
class FakeRedis {
  private store = new Map<string, string>();
  async set(k: string, v: string): Promise<"OK"> {
    this.store.set(k, v);
    return "OK";
  }
  async get(k: string): Promise<string | null> {
    return this.store.get(k) ?? null;
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }
}

describe("computeQrCode", () => {
  test("samma indata ger samma kod (deterministisk)", () => {
    const startedAt = new Date("2026-01-01T12:00:00Z");
    const now = new Date("2026-01-01T12:00:05Z");
    const a = computeQrCode("tok", "secret", startedAt, now);
    const b = computeQrCode("tok", "secret", startedAt, now);
    expect(a).toBe(b);
  });

  test("koden roterar när tiden går", () => {
    const startedAt = new Date("2026-01-01T12:00:00Z");
    const t1 = computeQrCode("tok", "secret", startedAt, new Date("2026-01-01T12:00:01Z"));
    const t2 = computeQrCode("tok", "secret", startedAt, new Date("2026-01-01T12:00:02Z"));
    expect(t1).not.toBe(t2);
  });

  test("formatet är bankid.<token>.<sekunder>.<hmac>", () => {
    const startedAt = new Date("2026-01-01T12:00:00Z");
    const code = computeQrCode("mytoken", "secret", startedAt, new Date("2026-01-01T12:00:03Z"));
    const parts = code.split(".");
    expect(parts[0]).toBe("bankid");
    expect(parts[1]).toBe("mytoken");
    expect(parts[2]).toBe("3");
    expect(parts[3]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("negativ förfluten tid (klockskillnad) golvas till 0, kastar inte", () => {
    const startedAt = new Date("2026-01-01T12:00:05Z");
    const code = computeQrCode("tok", "secret", startedAt, new Date("2026-01-01T12:00:00Z"));
    expect(code.split(".")[2]).toBe("0");
  });
});

describe("MockBankIdProvider — qr-fälten går genom samma formel", () => {
  test("init returnerar ett par som computeQrCode accepterar", async () => {
    const provider = new MockBankIdProvider(new FakeRedis() as never);
    const result = await provider.init({ personalNumber: "199001011234", endUserIp: "127.0.0.1" });
    expect(result.qrStartToken).toBeTruthy();
    expect(result.qrStartSecret).toBeTruthy();
    const code = computeQrCode(result.qrStartToken, result.qrStartSecret, result.qrStartedAt);
    expect(code.startsWith(`bankid.${result.qrStartToken}.`)).toBe(true);
  });
});

describe("RealBankIdProvider — mappning mot injicerat transport, inget nätanrop", () => {
  const cfg = {
    baseUrl: "https://example.test/rp/v6.1",
    certPath: "",
    certPassphrase: "",
    caPath: "",
  };

  test("init: personalNumber skickas med när det finns, mappar qr-fälten", async () => {
    let sentPath = "";
    let sentBody: Record<string, unknown> = {};
    const transport = async (path: string, body: Record<string, unknown>) => {
      sentPath = path;
      sentBody = body;
      return {
        orderRef: "order-1",
        autoStartToken: "auto-1",
        qrStartToken: "qr-tok",
        qrStartSecret: "qr-secret",
      };
    };
    const provider = new RealBankIdProvider(cfg, transport);
    const result = await provider.init({ personalNumber: "199001011234", endUserIp: "1.2.3.4" });

    expect(sentPath).toBe("/auth");
    expect(sentBody).toEqual({ personalNumber: "199001011234", endUserIp: "1.2.3.4" });
    expect(result.orderRef).toBe("order-1");
    expect(result.autoStartToken).toBe("auto-1");
    expect(result.qrStartToken).toBe("qr-tok");
    expect(result.qrStartSecret).toBe("qr-secret");
    expect(result.qrStartedAt).toBeInstanceOf(Date);
  });

  test("init: utan personalNumber (QR-flödet på annan enhet) skickas fältet inte alls", async () => {
    let sentBody: Record<string, unknown> = {};
    const transport = async (_path: string, body: Record<string, unknown>) => {
      sentBody = body;
      return { orderRef: "o", autoStartToken: "a", qrStartToken: "t", qrStartSecret: "s" };
    };
    const provider = new RealBankIdProvider(cfg, transport);
    await provider.init({ endUserIp: "1.2.3.4" });

    expect(sentBody).toEqual({ endUserIp: "1.2.3.4" });
    expect("personalNumber" in sentBody).toBe(false);
  });

  test("collect: pending/failed passerar igenom oförändrat", async () => {
    const transport = async () => ({ status: "pending", hintCode: "userSign" });
    const provider = new RealBankIdProvider(cfg, transport);
    await expect(provider.collect("order-1")).resolves.toEqual({
      status: "pending",
      hintCode: "userSign",
    });
  });

  test("collect: complete plattar ut completionData.user till completionData", async () => {
    const transport = async (path: string, body: Record<string, unknown>) => {
      expect(path).toBe("/collect");
      expect(body).toEqual({ orderRef: "order-1" });
      return {
        status: "complete",
        completionData: { user: { personalNumber: "199001011234", name: "Sienna Testperson" } },
      };
    };
    const provider = new RealBankIdProvider(cfg, transport);
    const result = await provider.collect("order-1");
    expect(result).toEqual({
      status: "complete",
      completionData: { personalNumber: "199001011234", name: "Sienna Testperson" },
    });
  });

  test("collect: complete utan completionData.user kastar (trasigt/oväntat BankID-svar)", async () => {
    const transport = async () => ({ status: "complete" });
    const provider = new RealBankIdProvider(cfg, transport);
    await expect(provider.collect("order-1")).rejects.toThrow();
  });

  test("cancel: skickar orderRef mot /cancel", async () => {
    let sentPath = "";
    let sentBody: Record<string, unknown> = {};
    const transport = async (path: string, body: Record<string, unknown>) => {
      sentPath = path;
      sentBody = body;
      return {};
    };
    const provider = new RealBankIdProvider(cfg, transport);
    await provider.cancel("order-1");
    expect(sentPath).toBe("/cancel");
    expect(sentBody).toEqual({ orderRef: "order-1" });
  });

  test("transport-fel (t.ex. icke-2xx) propagerar ut till anroparen", async () => {
    const transport = async () => {
      throw new Error("BankID /auth svarade 400: alreadyInProgress");
    };
    const provider = new RealBankIdProvider(cfg, transport);
    await expect(provider.init({ endUserIp: "1.2.3.4" })).rejects.toThrow("alreadyInProgress");
  });
});

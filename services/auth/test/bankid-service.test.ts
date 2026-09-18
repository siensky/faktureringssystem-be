import { describe, expect, test } from "bun:test";
import type { BankIdProvider, InitResult } from "../src/bankid/provider";

// services.ts importerar (via billing-client.ts) den riktiga config.ts, som
// kraschar vid import utan alla obligatoriska miljövariabler (code-style.md
// #28). Sätts INNAN den dynamiska importen nedan, så modulen aldrig laddas
// med en tom miljö — samma behov som config-guard.test.ts löser med en
// subprocess, men här räcker dummyvärden eftersom vi aldrig nätverkar ut
// (providern nedan är en fejk och config-objektet som skickas in i
// createBankIdService är ett eget, separat fejk-objekt).
for (const [key, value] of Object.entries({
  DATABASE_URL: "postgres://x/y",
  RABBITMQ_URL: "amqp://x",
  REDIS_URL: "redis://x",
  JWT_USER_SECRET: "u",
  JWT_SERVICE_SECRET: "s",
  AUTH_TOKEN_PEPPER: "p",
  PNR_HMAC_KEY: "deadbeef".repeat(8),
  BILLING_BASE_URL: "http://billing",
  AUTH_BASE_URL: "http://auth",
  AUTH_CLIENT_ID: "svc-auth",
  AUTH_CLIENT_SECRET: "c",
})) {
  process.env[key] = value;
}
const { createBankIdService } = await import("../src/bankid/services");

// Minimal Redis-fake — bara det assertInitRate (throttle.ts) använder.
class FakeRedis {
  private counters = new Map<string, number>();
  async incr(key: string): Promise<number> {
    const n = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, n);
    return n;
  }
  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }
}

const FAKE_RESULT: InitResult = {
  orderRef: "order-1",
  autoStartToken: "auto-1",
  qrStartToken: "qr-tok",
  qrStartSecret: "qr-secret",
  qrStartedAt: new Date(),
};

describe("bankid/services.ts init() — personalNumber är valfritt", () => {
  test("utan personnummer (QR-flödet) kraschar inte på pnr-nyckeln, providern får undefined", async () => {
    let receivedInput: { personalNumber?: string; endUserIp: string } | undefined;
    const provider: BankIdProvider = {
      init: async (input) => {
        receivedInput = input;
        return FAKE_RESULT;
      },
      collect: async () => ({ status: "pending" }),
      cancel: async () => {},
    };
    const service = createBankIdService({
      sql: {} as never,
      redis: new FakeRedis() as never,
      config: { pnrHmacKey: "deadbeef".repeat(8) } as never,
      provider,
    });

    const result = await service.init(undefined, "1.2.3.4");

    expect(result.orderRef).toBe("order-1");
    expect(receivedInput?.personalNumber).toBeUndefined();
    expect(receivedInput?.endUserIp).toBe("1.2.3.4");
  });

  test("med personnummer skickas det vidare till providern som vanligt", async () => {
    let receivedInput: { personalNumber?: string; endUserIp: string } | undefined;
    const provider: BankIdProvider = {
      init: async (input) => {
        receivedInput = input;
        return FAKE_RESULT;
      },
      collect: async () => ({ status: "pending" }),
      cancel: async () => {},
    };
    const service = createBankIdService({
      sql: {} as never,
      redis: new FakeRedis() as never,
      config: { pnrHmacKey: "deadbeef".repeat(8) } as never,
      provider,
    });

    await service.init("199001011234", "1.2.3.4");

    expect(receivedInput?.personalNumber).toBe("199001011234");
  });
});

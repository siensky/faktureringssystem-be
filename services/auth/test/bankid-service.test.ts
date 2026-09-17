import { describe, expect, test } from "bun:test";
import type { BankIdProvider, InitResult } from "../src/bankid/provider";
import { createBankIdService } from "../src/bankid/services";

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

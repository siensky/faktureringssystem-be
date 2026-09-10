// BankID bakom ett gränssnitt med två implementationer: MockBankIdProvider
// (lokalt + CI) och RealBankIdProvider (fas 11). Riktig BankID går inte
// att köra i en pipeline — mocken är en förutsättning för att e2e-testet
// ska kunna existera, inte en genväg (architecture.md #25, mock-undantaget).

import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

export type CollectStatus = "pending" | "complete" | "failed";

export interface InitResult {
  orderRef: string;
  autoStartToken: string;
  qrData: string;
}

export interface CollectResult {
  status: CollectStatus;
  hintCode?: string;
  completionData?: { personalNumber: string; name: string };
}

export interface BankIdProvider {
  init(input: { personalNumber?: string; endUserIp: string }): Promise<InitResult>;
  collect(orderRef: string): Promise<CollectResult>;
  cancel(orderRef: string): Promise<void>;
}

const KEY = (orderRef: string) => `bankid:mock:${orderRef}`;
const ORDER_TTL_SECONDS = 300;

/**
 * Mock. `personalNumber` styr utfallet i collect() via två sentinelvärden
 * som ändå är giltiga siffersträngar (schemat släpper bara igenom siffror):
 *   "000000000000" (12 nollor)  -> alltid pending
 *   "999999999999" (12 nior)     -> failed
 *   annat                           -> complete med det personnumret
 */
const PENDING_SENTINEL = "0".repeat(12);
const FAILED_SENTINEL = "9".repeat(12);
export class MockBankIdProvider implements BankIdProvider {
  constructor(private readonly redis: Redis) {}

  async init(input: { personalNumber?: string; endUserIp: string }): Promise<InitResult> {
    const orderRef = randomUUID();
    await this.redis.set(
      KEY(orderRef),
      JSON.stringify({ personalNumber: input.personalNumber ?? "" }),
      "EX",
      ORDER_TTL_SECONDS,
    );
    return { orderRef, autoStartToken: randomUUID(), qrData: `mock-qr:${orderRef}` };
  }

  async collect(orderRef: string): Promise<CollectResult> {
    const raw = await this.redis.get(KEY(orderRef));
    if (!raw) return { status: "failed", hintCode: "expiredTransaction" };

    const { personalNumber } = JSON.parse(raw) as { personalNumber: string };
    if (personalNumber === PENDING_SENTINEL) return { status: "pending", hintCode: "userSign" };
    if (personalNumber === FAILED_SENTINEL) {
      await this.redis.del(KEY(orderRef));
      return { status: "failed", hintCode: "userCancel" };
    }
    await this.redis.del(KEY(orderRef));
    return {
      status: "complete",
      completionData: { personalNumber, name: "Mock Testperson" },
    };
  }

  async cancel(orderRef: string): Promise<void> {
    await this.redis.del(KEY(orderRef));
  }
}

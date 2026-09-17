// BankID bakom ett gränssnitt med två implementationer: MockBankIdProvider
// (lokalt + CI) och RealBankIdProvider (fas 11, RP-testmiljön). Riktig
// BankID går inte att köra i en pipeline — mocken är en förutsättning för
// att e2e-testet ska kunna existera, inte en genväg (architecture.md #25,
// mock-undantaget). CI kör vidare mot mocken även efter denna fas.

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import type Redis from "ioredis";

export type CollectStatus = "pending" | "complete" | "failed";

export interface InitResult {
  orderRef: string;
  autoStartToken: string;
  /**
   * Rådata för BankIDs roterande QR-kod — INTE en färdig bild eller
   * sträng. Koden ändras ungefär varje sekund så länge ordern är öppen;
   * en konsument räknar fram den aktuella koden med computeQrCode() varje
   * gång den behöver visa/uppdatera QR-rutan. Mocken fyller i ett fejk-par
   * som går genom samma formel, så samma renderingskod fungerar mot båda
   * providers.
   */
  qrStartToken: string;
  qrStartSecret: string;
  qrStartedAt: Date;
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

/**
 * BankIDs QR-algoritm (RP-guidelines): koden är
 * `bankid.<qrStartToken>.<sekunder sedan init>.<hmac-sha256(qrStartSecret, sekunder)>`.
 * Måste kallas om och om igen medan ordern är öppen — det är inte en
 * engångssträng, till skillnad från autoStartToken.
 */
export function computeQrCode(
  qrStartToken: string,
  qrStartSecret: string,
  qrStartedAt: Date,
  now: Date = new Date(),
): string {
  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - qrStartedAt.getTime()) / 1000));
  const qrAuthCode = createHmac("sha256", qrStartSecret)
    .update(String(elapsedSeconds))
    .digest("hex");
  return `bankid.${qrStartToken}.${elapsedSeconds}.${qrAuthCode}`;
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
    return {
      orderRef,
      autoStartToken: randomUUID(),
      qrStartToken: randomUUID(),
      qrStartSecret: randomBytes(32).toString("hex"),
      qrStartedAt: new Date(),
    };
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

export interface RealBankIdConfig {
  baseUrl: string;
  certPath: string;
  certPassphrase: string;
  caPath: string;
}

/** Ett BankID-anrop: path ("/auth", "/collect", "/cancel") + JSON-body in, tolkat JSON-svar ut. Kastar på icke-2xx. */
type BankIdTransport = (path: string, body: Record<string, unknown>) => Promise<unknown>;

/**
 * Riktig HTTP-transport mot BankIDs RP-API, byggd på node:https i stället
 * för fetch: BankID levererar ett PKCS12-certifikat (.p12), och varken
 * Buns eller webbens fetch tar emot `pfx` — node:https tls.Agent gör det
 * direkt, samma mönster som BankIDs egna Node.js-exempelklienter.
 * Certifikatfilerna läses här, inte av RealBankIdProvider själv, så ett
 * injicerat test-transport (se bankid-provider.test.ts) aldrig rör
 * filsystemet.
 */
function createHttpsTransport(cfg: RealBankIdConfig): BankIdTransport {
  const agent = new https.Agent({
    pfx: readFileSync(cfg.certPath),
    passphrase: cfg.certPassphrase,
    ca: readFileSync(cfg.caPath),
  });
  const base = new URL(cfg.baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");

  return (path, body) =>
    new Promise((resolve, reject) => {
      const payload = Buffer.from(JSON.stringify(body));
      const req = https.request(
        {
          agent,
          protocol: base.protocol,
          hostname: base.hostname,
          port: base.port || 443,
          path: `${basePath}${path}`,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": payload.length,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(new Error(`BankID ${path} svarade ${status}: ${text}`));
              return;
            }
            try {
              resolve(text ? JSON.parse(text) : {});
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        },
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
}

/**
 * Riktig BankID RP-API mot testmiljön (BANKID_BASE_URL, default v6.0 mot
 * appapi2.test.bankid.com — se services/auth/src/config.ts. INTE v6.1:
 * manuellt verifierat att det delade RP-testcertifikatet ger ett blankt
 * 403 på v6.1 men fungerar på v6.0, samma version BankID kör i
 * produktion). Mocken tas inte bort; CI kör vidare mot den (PLAN.md, fas
 * 11). Den här klassen verifieras med ett injicerat test-transport i
 * stället för ett riktigt nätanrop mot BankID, se bankid-provider.test.ts.
 *
 * BankIDs svar nästlar completionData.user ({ completionData: { user: {
 * personalNumber, name } } }) — plattas ut här till samma form som mocken
 * redan returnerar, så services.ts aldrig behöver veta vilken provider som
 * svarade.
 */
export class RealBankIdProvider implements BankIdProvider {
  private readonly transport: BankIdTransport;

  constructor(cfg: RealBankIdConfig, transport?: BankIdTransport) {
    this.transport = transport ?? createHttpsTransport(cfg);
  }

  async init(input: { personalNumber?: string; endUserIp: string }): Promise<InitResult> {
    const body: Record<string, unknown> = { endUserIp: input.endUserIp };
    // BankID stödjer init utan personnummer (QR-flödet startar då på
    // "annan enhet"); tom sträng skulle bli ett värdelöst fält i requesten.
    if (input.personalNumber) body.personalNumber = input.personalNumber;

    const res = (await this.transport("/auth", body)) as {
      orderRef: string;
      autoStartToken: string;
      qrStartToken: string;
      qrStartSecret: string;
    };
    return {
      orderRef: res.orderRef,
      autoStartToken: res.autoStartToken,
      qrStartToken: res.qrStartToken,
      qrStartSecret: res.qrStartSecret,
      qrStartedAt: new Date(),
    };
  }

  async collect(orderRef: string): Promise<CollectResult> {
    const res = (await this.transport("/collect", { orderRef })) as {
      status: CollectStatus;
      hintCode?: string;
      completionData?: { user: { personalNumber: string; name: string } };
    };
    if (res.status !== "complete") {
      return { status: res.status, hintCode: res.hintCode };
    }
    const user = res.completionData?.user;
    if (!user) {
      throw new Error("BankID svarade complete utan completionData.user");
    }
    return {
      status: "complete",
      completionData: { personalNumber: user.personalNumber, name: user.name },
    };
  }

  async cancel(orderRef: string): Promise<void> {
    await this.transport("/cancel", { orderRef });
  }
}

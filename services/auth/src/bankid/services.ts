// BankID-inloggning. En lyckad signering skapar ALDRIG ett konto
// (domain.md #22): finns ingen användare med matchande pnr_hash blir det
// 401. Personnumret hashas med samma HMAC-nyckel som customers.pnr_hmac
// (planens Personnummer-avsnitt) och lagras aldrig i klartext.

import { Forbidden, Unauthorized, hmacField, normalizePnr } from "@faktura/shared";
import type Redis from "ioredis";
import type { Sql } from "postgres";
import type { config as Config } from "../config";
import { createSessionIssuer } from "../session";
import { assertInitRate, recordLoginFailure } from "../throttle";
import type { BankIdProvider, CollectResult } from "./provider";
import { createBankIdRepository } from "./repository";

interface Deps {
  sql: Sql;
  redis: Redis;
  config: typeof Config;
  provider: BankIdProvider;
}

export function createBankIdService(deps: Deps) {
  const repo = createBankIdRepository(deps.sql);
  const sessionIssuer = createSessionIssuer({ sql: deps.sql, config: deps.config });

  return {
    async init(personalNumber: string, endUserIp: string) {
      // Windowed rate-limit per IP OCH per personnummer — BankID-init är en
      // kostnadsyta (planens Rate limiting-avsnitt). Båda nycklarna
      // inkrementeras vid varje anrop.
      await assertInitRate(deps.redis, `bankid-init:ip:${endUserIp}`);
      // Kanonisera till 12 siffror så 10- och 12-siffrig form nycklar lika
      // (samma kanonisering som billing customers.pnr_hmac använder).
      await assertInitRate(
        deps.redis,
        `bankid-init:pnr:${hmacField(normalizePnr(personalNumber), deps.config.pnrHmacKey)}`,
      );
      const { orderRef, autoStartToken, qrData } = await deps.provider.init({
        personalNumber,
        endUserIp,
      });
      return { orderRef, autoStartToken, qrData };
    },

    async collect(orderRef: string) {
      const result: CollectResult = await deps.provider.collect(orderRef);

      if (result.status !== "complete") {
        return { status: result.status, hintCode: result.hintCode };
      }

      const pnr = normalizePnr(result.completionData!.personalNumber);
      const pnrHash = hmacField(pnr, deps.config.pnrHmacKey);
      const user = await repo.findBankIdUserByPnrHash(pnrHash);

      if (!user) {
        // Ingen matchande användare -> avvisa. Inget konto skapas.
        await recordLoginFailure(deps.redis, `bankid:${pnrHash}`);
        throw new Unauthorized("Ingen användare kopplad till detta BankID");
      }
      if ((await repo.getTenantStatus(user.tenant_id)) !== "active") {
        throw new Forbidden("Kontot är avstängt");
      }

      const tokens = await sessionIssuer.issue(user);
      return { status: "complete" as const, ...tokens };
    },
  };
}

export type BankIdService = ReturnType<typeof createBankIdService>;

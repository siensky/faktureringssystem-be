// BankID-inloggning. En lyckad signering skapar ALDRIG ett konto
// (domain.md #22): finns ingen användare med matchande pnr_hash blir det
// 401. Personnumret hashas med samma HMAC-nyckel som customers.pnr_hmac
// (planens Personnummer-avsnitt) och lagras aldrig i klartext.

import { Forbidden, Unauthorized, hmacField } from "@faktura/shared";
import type Redis from "ioredis";
import type { Sql } from "postgres";
import type { config as Config } from "../config";
import { createSessionIssuer } from "../session";
import { assertNotLockedOut, recordLoginFailure } from "../throttle";
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
      // Strypning per IP och per personnummer — BankID-init är en
      // kostnadsyta (planens Rate limiting-avsnitt).
      await assertNotLockedOut(deps.redis, `bankid:${endUserIp}`);
      await assertNotLockedOut(
        deps.redis,
        `bankid:${hmacField(personalNumber, deps.config.pnrHmacKey)}`,
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

      const pnr = result.completionData!.personalNumber;
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

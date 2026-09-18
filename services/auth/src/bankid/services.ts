// BankID-inloggning. En lyckad signering skapar ALDRIG ett konto
// (domain.md #22): finns ingen användare med matchande pnr_hash blir det
// 401. Personnumret hashas med samma HMAC-nyckel som customers.pnr_hmac
// (planens Personnummer-avsnitt) och lagras aldrig i klartext.

import { Forbidden, Unauthorized, hmacField, normalizePnr } from "@faktura/shared";
import type { Logger } from "@faktura/shared";
import type Redis from "ioredis";
import type { Sql } from "postgres";
import {
  type CustomerCompanyMatch,
  findCustomersByPnrHmac,
  getPortalAccountSummary,
} from "../billing-client";
import type { config as Config } from "../config";
import { createSessionIssuer } from "../session";
import { assertInitRate, recordLoginFailure } from "../throttle";
import type { BankIdProvider, CollectResult } from "./provider";
import { type BankIdRepository, createBankIdRepository } from "./repository";

interface Deps {
  sql: Sql;
  redis: Redis;
  config: typeof Config;
  provider: BankIdProvider;
  logger?: Logger;
  // Injicerbara, defaultar till de riktiga implementationerna — precis som
  // RealBankIdProvider tar ett valfritt test-transport (fas 11). Ändrar
  // inget produktionsbeteende, bara vad som går att byta ut i test utan en
  // riktig databas (kodgranskning fas 12).
  repo?: BankIdRepository;
  findCustomersByPnrHmac?: typeof findCustomersByPnrHmac;
  getPortalAccountSummary?: typeof getPortalAccountSummary;
}

export function createBankIdService(deps: Deps) {
  const repo = deps.repo ?? createBankIdRepository(deps.sql);
  const lookupCustomersByPnrHmac = deps.findCustomersByPnrHmac ?? findCustomersByPnrHmac;
  const fetchAccountSummary = deps.getPortalAccountSummary ?? getPortalAccountSummary;
  const sessionIssuer = createSessionIssuer({ sql: deps.sql, config: deps.config });

  return {
    async init(personalNumber: string | undefined, endUserIp: string) {
      // Windowed rate-limit per IP OCH (om känt) per personnummer — BankID-
      // init är en kostnadsyta (planens Rate limiting-avsnitt).
      await assertInitRate(deps.redis, `bankid-init:ip:${endUserIp}`);
      if (personalNumber) {
        // Kanonisera till 12 siffror så 10- och 12-siffrig form nycklar lika
        // (samma kanonisering som billing customers.pnr_hmac använder).
        await assertInitRate(
          deps.redis,
          `bankid-init:pnr:${hmacField(normalizePnr(personalNumber), deps.config.pnrHmacKey)}`,
        );
      }
      const { orderRef, autoStartToken, qrStartToken, qrStartSecret, qrStartedAt } =
        await deps.provider.init({ personalNumber, endUserIp });
      return { orderRef, autoStartToken, qrStartToken, qrStartSecret, qrStartedAt };
    },

    /**
     * Fas 12: BankID-kundigenkänning, tenant-övergripande. En lyckad
     * signering skapar ALDRIG en customers-rad (bara en admin gör det) —
     * den FÅR skapa en users-inloggningsidentitet, en gång, om
     * personnumret redan matchar minst en privat kund hos NÅGON tenant
     * (domain.md #22, omskriven scope). Ingen matchning alls -> 401, ingen
     * rad skapas.
     *
     * Sessionen förblir enda-tenant precis som alltid — identiteten kan
     * vara länkad till flera företag, men det utfärdade tokenet gäller
     * exakt ett (det senast använda, eller första vid en ny identitet).
     * Att byta företag görs via POST /auth/companies/switch.
     */
    async collect(orderRef: string, correlationId: string) {
      const result: CollectResult = await deps.provider.collect(orderRef);

      if (result.status !== "complete") {
        return { status: result.status, hintCode: result.hintCode };
      }

      const pnr = normalizePnr(result.completionData!.personalNumber);
      const pnrHash = hmacField(pnr, deps.config.pnrHmacKey);

      const matches = await lookupCustomersByPnrHmac(deps.redis, pnrHash, correlationId);
      const activeMatches: CustomerCompanyMatch[] = [];
      for (const match of matches) {
        if ((await repo.getTenantStatus(match.tenantId)) === "active") {
          activeMatches.push(match);
        }
      }

      if (activeMatches.length === 0) {
        // Ingen matchande privatkund hos någon aktiv tenant -> avvisa.
        // Inget konto skapas.
        await recordLoginFailure(deps.redis, `bankid:${pnrHash}`);
        throw new Unauthorized("Ingen kund kopplad till detta BankID");
      }

      const identity = await deps.sql.begin(async (tx) => {
        const user = await repo.findOrCreateBankIdCustomerIdentity(tx, pnrHash);
        await repo.syncCompanyLinks(tx, user.id, activeMatches);
        return user;
      });

      const links = await repo.listCompanyLinks(identity.id);
      const active = links[0];
      if (!active) throw new Error("Inga företagslänkar trots minst en aktiv matchning");
      await repo.touchLink(identity.id, active.tenant_id);

      const tokens = await sessionIssuer.issue({
        id: identity.id,
        tenant_id: active.tenant_id,
        role: "customer",
        customer_id: active.customer_id,
      });

      return {
        status: "complete" as const,
        ...tokens,
        companies: links.map((link) => ({
          tenantId: link.tenant_id,
          tenantName: link.tenant_name,
          customerId: link.customer_id,
        })),
      };
    },

    /**
     * Byter aktivt företag för en redan inloggad BankID-kundidentitet.
     * Verifierar ALLTID server-side mot user_company_links — litar aldrig
     * på klientens tenantId (architecture.md #13/#17). Meningslös för
     * lösenordskunder: de har inga rader i user_company_links och får
     * samma Forbidden som ett olänkat företag.
     */
    async switchCompany(userId: number, tenantId: number) {
      const link = await repo.findLink(userId, tenantId);
      if (!link) throw new Forbidden("Inget företag kopplat till det här kontot");
      if ((await repo.getTenantStatus(tenantId)) !== "active") {
        throw new Forbidden("Kontot är avstängt");
      }
      await repo.touchLink(userId, tenantId);
      return sessionIssuer.issue({
        id: userId,
        tenant_id: tenantId,
        role: "customer",
        customer_id: link.customer_id,
      });
    },

    /**
     * Företagsöversikten: en accountSummary-läsning PER länkat företag,
     * aldrig en fråga som själv korsar tenant_id (PortalRepository/
     * PortalService är helt oförändrade, se services/billing/src/portal/).
     * Tom lista för en lösenordskund (inga rader i user_company_links) —
     * inget fel, bara en tom översikt.
     *
     * allSettled, inte all: ett trögt/trasigt företag ska inte dölja de
     * andra — kunden ser sina fungerande bolag i stället för ett totalt
     * fel för alla (kodgranskning fas 12). Ett misslyckat företag loggas
     * och utelämnas tyst ur listan snarare än att krascha hela anropet.
     */
    async overview(userId: number, correlationId: string) {
      const links = await repo.listCompanyLinks(userId);
      const results = await Promise.allSettled(
        links.map(async (link) => {
          const summary = await fetchAccountSummary(
            deps.redis,
            link.tenant_id,
            link.customer_id,
            correlationId,
          );
          return {
            tenantId: link.tenant_id,
            tenantName: link.tenant_name,
            customerId: link.customer_id,
            outstanding: summary.outstanding,
            outstandingInvoiceCount: summary.outstandingInvoiceCount,
          };
        }),
      );
      const companies = [];
      for (const [i, result] of results.entries()) {
        if (result.status === "fulfilled") {
          companies.push(result.value);
        } else {
          deps.logger?.warn(
            { err: result.reason, tenantId: links[i]?.tenant_id, correlationId },
            "företagsöversikt: kunde inte hämta accountSummary för ett länkat företag, utelämnar det",
          );
        }
      }
      return { companies };
    },
  };
}

export type BankIdService = ReturnType<typeof createBankIdService>;

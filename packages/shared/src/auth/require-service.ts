// requireService(scope): Fastify-preHandler för tjänst-till-tjänst-anrop.
// Den ANDRA av de två separata verifieringsfunktionerna (architecture.md
// #16) — aldrig en generisk "verifiera token".
//
// X-Tenant-Id läses HÄR (och bara här): en autentiserad tjänst får hävda
// vilken tenant den agerar för (#17). Är headern satt valideras den mot
// tenantens status (PLAN.md Domänmodell #8: en avstängd tenant får inte
// nås ens via S2S). Saknas headern sätts ingen tenant — en handler som
// KRÄVER en tenant ska då avvisa med `requireTenantHeader` (400), och
// repository-basklassen kastar som sista skyddsnät (fail closed, #21).

import type { FastifyReply, FastifyRequest } from "fastify";
import { BadRequest, Forbidden, Unauthorized } from "../errors";
import { resolveCorrelationId } from "./correlation";
import { assertScope, verifyServiceToken } from "./service-tokens";

export interface ServiceContext {
  clientId: string;
  scopes: string[];
  /** Från X-Tenant-Id om satt och giltig. undefined annars. */
  tenantId?: number;
  correlationId: string;
}

/** Returnerar true om tenanten finns och är aktiv. */
export type TenantActiveCheck = (tenantId: number) => Promise<boolean>;

declare module "fastify" {
  interface FastifyRequest {
    serviceCtx?: ServiceContext;
  }
}

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new Unauthorized("Authorization: Bearer-token saknas");
  }
  return header.slice("Bearer ".length).trim();
}

function tenantIdFromHeader(request: FastifyRequest): number | undefined {
  const raw = request.headers["x-tenant-id"];
  if (raw === undefined) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new BadRequest("X-Tenant-Id måste vara ett positivt heltal");
  }
  return n;
}

export function createRequireService(
  serviceSecret: string,
  opts: { checkTenantActive?: TenantActiveCheck } = {},
) {
  return function requireService(requiredScope: string) {
    return async function preHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      const { clientId, scopes } = await verifyServiceToken(bearer(request), serviceSecret);
      assertScope(scopes, requiredScope); // kastar Forbidden (403) vid fel scope

      const tenantId = tenantIdFromHeader(request);
      if (tenantId !== undefined && opts.checkTenantActive) {
        if (!(await opts.checkTenantActive(tenantId))) {
          throw new Forbidden("Tenanten finns inte eller är avstängd");
        }
      }

      request.serviceCtx = {
        clientId,
        scopes,
        tenantId,
        correlationId: resolveCorrelationId(request.headers["x-correlation-id"]),
      };
    };
  };
}

export function serviceContextOf(request: FastifyRequest): ServiceContext {
  if (!request.serviceCtx) {
    throw new Unauthorized("Ingen tjänste-kontext på requesten");
  }
  return request.serviceCtx;
}

/**
 * För en S2S-handler som KRÄVER en tenant: returnerar tenant-id eller
 * kastar BadRequest (400). Ett medvetet klientfel — inte ett 500 från
 * repository-gettern, som är sista skyddsnätet, inte förstahandsvalet.
 */
export function requireTenantHeader(request: FastifyRequest): number {
  const ctx = serviceContextOf(request);
  if (ctx.tenantId === undefined) {
    throw new BadRequest("X-Tenant-Id krävs för denna endpoint");
  }
  return ctx.tenantId;
}

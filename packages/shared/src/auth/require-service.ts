// requireService(scope): Fastify-preHandler för tjänst-till-tjänst-anrop.
// Den ANDRA av de två separata verifieringsfunktionerna (architecture.md
// #16) — aldrig en generisk "verifiera token".
//
// X-Tenant-Id läses HÄR (och bara här): en autentiserad tjänst får hävda
// vilken tenant den agerar för (#17). Saknas headern sätts ingen tenant —
// och ett efterföljande tenant-scopat repository-anrop kastar då
// (fail closed, #20). requireService i sig kräver den alltså inte.

import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { BadRequest, Unauthorized } from "../errors";
import { assertScope, verifyServiceToken } from "./service-tokens";

export interface ServiceContext {
  clientId: string;
  scopes: string[];
  /** Från X-Tenant-Id om satt och giltig. undefined annars. */
  tenantId?: number;
  correlationId: string;
}

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

export function createRequireService(serviceSecret: string) {
  return function requireService(requiredScope: string) {
    return async function preHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      const { clientId, scopes } = await verifyServiceToken(bearer(request), serviceSecret);
      assertScope(scopes, requiredScope); // kastar Forbidden (403) vid fel scope

      request.serviceCtx = {
        clientId,
        scopes,
        tenantId: tenantIdFromHeader(request),
        correlationId: (request.headers["x-correlation-id"] as string | undefined) ?? randomUUID(),
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

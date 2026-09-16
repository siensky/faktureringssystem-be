// Små Fastify-preHandlers och request-helpers som billing lägger ovanpå
// requireUser / requireService. Ingen affärslogik — bara grindar.

import { BadRequest, Forbidden, contextOf } from "@faktura/shared";
import type { FastifyReply, FastifyRequest } from "fastify";

/** Körs EFTER requireUser. /admin/* är bara för admins, inte kundportal-roller. */
export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (contextOf(request).role !== "admin") {
    throw new Forbidden("Endast administratörer har åtkomst till den här resursen");
  }
}

/** Körs EFTER requireUser. /portal/* är bara för kundportal-roller, inte admins. */
export async function requireCustomer(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (contextOf(request).role !== "customer") {
    throw new Forbidden("Endast kundportalen har åtkomst till den här resursen");
  }
}

/** X-Correlation-Id från headern om satt, annars undefined (servicen genererar). */
export function correlationIdOf(request: FastifyRequest): string | undefined {
  const raw = request.headers["x-correlation-id"];
  return (Array.isArray(raw) ? raw[0] : raw) || undefined;
}

/**
 * Idempotency-Key-headern. Obligatorisk på allt som förbrukar ett
 * fakturanummer eller skapar en bokföringspost (architecture.md #10).
 */
export function idempotencyKeyOf(request: FastifyRequest): string {
  const raw = request.headers["idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || key.length < 8 || key.length > 200) {
    throw new BadRequest("Idempotency-Key-header krävs (8–200 tecken)");
  }
  return key;
}

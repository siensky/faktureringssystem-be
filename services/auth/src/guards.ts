// Liten Fastify-preHandler ovanpå requireUser — samma mönster som billings
// services/billing/src/guards.ts:s requireAdmin. Ingen affärslogik, bara
// en grind.

import { Forbidden, contextOf } from "@faktura/shared";
import type { FastifyReply, FastifyRequest } from "fastify";

/** Körs EFTER requireUser. POST /auth/customer-invites är bara för admins. */
export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (contextOf(request).role !== "admin") {
    throw new Forbidden("Endast administratörer har åtkomst till den här resursen");
  }
}

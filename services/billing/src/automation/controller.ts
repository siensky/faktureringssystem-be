// POST /internal/automation/run — skyddad drift-endpoint för manuell
// körning av det dagliga jobbet (PLAN.md fas 6). Samma mönster som
// services/payments/src/ops: under /internal/ så nginx blockerar den
// utifrån, requireService(scope) som enda auth, inget seedat konto som
// standard — en operatör som behöver den provisionerar en klient manuellt
// (se BILLING_OPS_CLIENT_* i infra/seed/seed.ts).

import { Conflict } from "@faktura/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AutomationRunner } from "./runner";

export function createAutomationController(runner: AutomationRunner) {
  return {
    async run(_request: FastifyRequest, reply: FastifyReply) {
      const result = await runner.runOnce();
      if (result.locked) {
        throw new Conflict("En automatiseringskörning pågår redan");
      }
      const { locked: _locked, ...summary } = result;
      return reply.send(summary);
    },
  };
}

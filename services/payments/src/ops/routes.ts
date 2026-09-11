import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { BankTransactionRepository } from "../transactions/repository";
import { createOpsController } from "./controller";

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerOpsRoutes(
  app: FastifyInstance,
  repo: BankTransactionRepository,
  deps: { requireService: (scope: string) => PreHandler },
): void {
  const c = createOpsController(repo);

  app.get(
    "/internal/ops/payments/unknown-bankgiro",
    { preHandler: deps.requireService("payments:ops:read") },
    c.unknownBankgiro,
  );
}

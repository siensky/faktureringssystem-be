import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createAutomationController } from "./controller";
import type { AutomationRunner } from "./runner";

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerAutomationRoutes(
  app: FastifyInstance,
  runner: AutomationRunner,
  deps: { requireService: (scope: string) => PreHandler },
): void {
  const c = createAutomationController(runner);

  app.post(
    "/internal/automation/run",
    { preHandler: deps.requireService("billing:ops:run") },
    c.run,
  );
}

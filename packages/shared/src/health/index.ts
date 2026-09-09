// /health/live och /health/ready, delade av alla fyra tjänsterna. Se
// planens "Säkerhet: Transportnära grunder" — live svarar att processen
// lever (för omstartsbeslut), ready kollar faktiska beroenden (för
// Docker healthcheck och nginx upstream) så en tillfälligt onåbar databas
// inte får en frisk process omstartad i onödan.

import type { FastifyInstance } from "fastify";

export interface ReadinessCheck {
  name: string;
  check: () => Promise<void>;
}

// De fyra "any" i generic-listan är Logger-typparametern (index 4) satt
// löst: en tjänst som skapar Fastify med en egen pino-instans via
// loggerInstance får en annan konkret Logger-generic än Fastifys default,
// och den exakta typen är irrelevant för en funktion som bara anropar
// app.get() — code-style.md #16.
export function registerHealthRoutes(
  app: FastifyInstance<any, any, any, any, any>,
  checks: ReadinessCheck[] = [],
): void {
  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_request, reply) => {
    const results = await Promise.allSettled(checks.map((c) => c.check()));
    const failed = checks
      .map((c, i) => ({ name: c.name, result: results[i] }))
      .filter((entry) => entry.result?.status === "rejected");

    if (failed.length > 0) {
      return reply.status(503).send({
        status: "unhealthy",
        failed: failed.map((f) => f.name),
      });
    }

    return { status: "ok" };
  });
}

// POST /internal/payments/import — rå body, Content-Type: text/plain
// (inget multipart). Redan blockerad utifrån av nginx via den befintliga
// /internal/-spärren, samma som alla andra /internal/*-endpoints — ingen
// ny nginx-regel behövs.
//
// bodyLimit höjs BARA för den här routen (5 MB) — global 256 KB
// (packages/shared/src/service/index.ts) räcker inte för en fil med
// hundratals transaktioner. Native Fastify route-option, ingen ny
// abstraktion.

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ImportService } from "./service";

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

const IMPORT_BODY_LIMIT = 5 * 1024 * 1024;

export function registerImportRoutes(
  app: FastifyInstance,
  importService: ImportService,
  deps: { requireService: (scope: string) => PreHandler },
): void {
  app.post(
    "/internal/payments/import",
    {
      preHandler: deps.requireService("payments:ops:import"),
      bodyLimit: IMPORT_BODY_LIMIT,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Fastifys inbyggda text/plain-parser ger en sträng direkt — ingen
      // egen content-type-parser behövs här (till skillnad från
      // webhooks/routes.ts, som medvetet UNDVIKER Fastifys automatiska
      // parsning för att kunna verifiera en signatur över rå body FÖRE
      // parsning).
      const fileText = String(request.body ?? "");
      const correlationId = String(request.headers["x-correlation-id"] ?? "");

      const summary = await importService.importFile(fileText, correlationId || randomUUID());
      return reply.status(200).send(summary);
    },
  );
}

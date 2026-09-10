import type { FastifyInstance } from "fastify";
import { createM2mControllers } from "./controllers";
import * as schema from "./schema";
import type { M2mService } from "./services";

export function registerM2mRoutes(
  app: FastifyInstance,
  service: M2mService,
  strictLimit: object,
): void {
  const c = createM2mControllers(service);
  app.post("/auth/token", { schema: { body: schema.tokenBody }, ...strictLimit }, c.token);
}

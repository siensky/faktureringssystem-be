import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createCompanySettingsControllers } from "./controllers";
import * as schema from "./schema";
import type { CompanySettingsService } from "./services";
import type { CompanySettingsPatch } from "./types";

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerCompanySettingsRoutes(
  app: FastifyInstance,
  service: CompanySettingsService,
  deps: {
    userChain: PreHandler[];
    requireService: (scope: string) => PreHandler;
  },
): void {
  const c = createCompanySettingsControllers(service);

  app.get("/admin/company-settings", { preHandler: deps.userChain }, c.get);
  app.put<{ Body: CompanySettingsPatch }>(
    "/admin/company-settings",
    { preHandler: deps.userChain, schema: { body: schema.updateCompanySettingsBody } },
    c.update,
  );

  app.get(
    "/internal/company-settings",
    { preHandler: deps.requireService("billing:company:read") },
    c.getInternal,
  );
}

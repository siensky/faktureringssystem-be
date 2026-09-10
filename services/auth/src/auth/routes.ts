// HTTP-vägar + schemavalidering. Kopplar route -> controller. Känsliga
// endpoints får ett hårdare per-IP-tak ovanpå det globala (planens
// "grov i nginx, fin i Fastify") — den per-KONTO-strypningen sitter i
// servicen via Redis.

import type { FastifyInstance } from "fastify";
import { createAuthControllers } from "./controllers";
import * as schema from "./schema";
import type { AuthService } from "./services";

export function registerAuthRoutes(
  app: FastifyInstance,
  service: AuthService,
  opts: { devEndpointsEnabled: boolean; strictRateLimitMax: number },
): void {
  const c = createAuthControllers(service);
  const strictLimit = {
    config: { rateLimit: { max: opts.strictRateLimitMax, timeWindow: "1 minute" } },
  };

  app.post("/auth/register", { schema: { body: schema.registerBody }, ...strictLimit }, c.register);
  app.post(
    "/auth/verify-email",
    { schema: { body: schema.verifyEmailBody }, ...strictLimit },
    c.verifyEmail,
  );
  app.post("/auth/login", { schema: { body: schema.loginBody }, ...strictLimit }, c.login);
  app.post("/auth/refresh", { schema: { body: schema.refreshBody } }, c.refresh);
  app.post("/auth/logout", { schema: { body: schema.logoutBody } }, c.logout);
  app.post(
    "/auth/forgot-password",
    { schema: { body: schema.forgotPasswordBody }, ...strictLimit },
    c.forgotPassword,
  );
  app.post(
    "/auth/reset-password",
    { schema: { body: schema.resetPasswordBody }, ...strictLimit },
    c.resetPassword,
  );

  if (opts.devEndpointsEnabled) {
    // Bara i icke-produktion med AUTH_DEV_ENDPOINTS=true. Ersätter mejlet
    // som documents skickar från fas 4 — låter register -> verifiera ->
    // login-kedjan gå att prova för hand och i e2e-testet redan i fas 1.
    app.get("/auth/dev/token", { schema: { querystring: schema.devTokenQuery } }, c.devToken);
  }
}

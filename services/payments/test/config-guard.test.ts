import { describe, expect, test } from "bun:test";

// config.ts kör produktionsspärren vid import. Vi importerar den i en
// subprocess med olika env för att verifiera att den kraschar med mock i
// produktion, och med "real" utan en nyckel oavsett miljö. Samma mönster
// som services/auth/test/config-guard.test.ts (BANKID_PROVIDER).
function loadConfig(env: Record<string, string>): { code: number; stderr: string } {
  const base = {
    DATABASE_URL: "postgres://x/y",
    RABBITMQ_URL: "amqp://x",
    REDIS_URL: "redis://x",
    JWT_USER_SECRET: "u",
    JWT_SERVICE_SECRET: "s",
    PAYMENT_WEBHOOK_SECRET: "w",
    BILLING_BASE_URL: "http://billing",
    AUTH_BASE_URL: "http://auth",
    PAYMENTS_CLIENT_ID: "svc-payments",
    PAYMENTS_CLIENT_SECRET: "c",
    STRIPE_WEBHOOK_SECRET: "sw",
    PORTAL_BASE_URL: "http://portal",
  };
  const proc = Bun.spawnSync(["bun", "-e", "import('./src/config.ts')"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...base, ...env, PATH: process.env.PATH ?? "" },
  });
  return { code: proc.exitCode ?? 0, stderr: proc.stderr.toString() };
}

describe("Stripe-produktionsspärr i config", () => {
  test("kraschar med mock i produktion", () => {
    const r = loadConfig({ NODE_ENV: "production", STRIPE_PROVIDER: "mock" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("STRIPE_PROVIDER");
  });

  test("kraschar med real utan STRIPE_SECRET_KEY, oavsett miljö", () => {
    const r = loadConfig({ NODE_ENV: "development", STRIPE_PROVIDER: "real" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("STRIPE_SECRET_KEY");
  });

  test("startar med mock i utveckling", () => {
    expect(loadConfig({ NODE_ENV: "development", STRIPE_PROVIDER: "mock" }).code).toBe(0);
  });

  test("startar med real + nyckel i produktion", () => {
    expect(
      loadConfig({
        NODE_ENV: "production",
        STRIPE_PROVIDER: "real",
        STRIPE_SECRET_KEY: "sk_test_x",
      }).code,
    ).toBe(0);
  });
});

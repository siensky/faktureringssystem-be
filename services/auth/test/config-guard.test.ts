import { describe, expect, test } from "bun:test";

// config.ts kör produktionsspärren vid import. Vi importerar den i en
// subprocess med olika env för att verifiera att den kraschar med mock i
// produktion men inte annars.
function loadConfig(env: Record<string, string>): { code: number; stderr: string } {
  const base = {
    DATABASE_URL: "postgres://x/y",
    RABBITMQ_URL: "amqp://x",
    REDIS_URL: "redis://x",
    JWT_USER_SECRET: "u",
    JWT_SERVICE_SECRET: "s",
    AUTH_TOKEN_PEPPER: "p",
    PNR_HMAC_KEY: "h",
    BILLING_BASE_URL: "http://billing",
    AUTH_BASE_URL: "http://auth",
    AUTH_CLIENT_ID: "svc-auth",
    AUTH_CLIENT_SECRET: "c",
  };
  const proc = Bun.spawnSync(["bun", "-e", "import('./src/config.ts')"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...base, ...env, PATH: process.env.PATH ?? "" },
  });
  return { code: proc.exitCode ?? 0, stderr: proc.stderr.toString() };
}

describe("BankID-produktionsspärr i config", () => {
  test("kraschar med mock i produktion", () => {
    const r = loadConfig({ NODE_ENV: "production", BANKID_PROVIDER: "mock" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("BANKID_PROVIDER");
  });

  test("startar med mock i utveckling", () => {
    expect(loadConfig({ NODE_ENV: "development", BANKID_PROVIDER: "mock" }).code).toBe(0);
  });

  test("startar med real i produktion", () => {
    expect(loadConfig({ NODE_ENV: "production", BANKID_PROVIDER: "real" }).code).toBe(0);
  });
});

import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { REDACT_PATHS, createLogger } from "../src/logger";

function captureDestination() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, destination };
}

describe("createLogger", () => {
  test("maskerar password, oavsett djup i objektet", () => {
    const { lines, destination } = captureDestination();
    const logger = createLogger("auth", {}, destination);

    logger.info({ email: "a@example.com", password: "hemligt123" }, "login attempt");

    const logged = JSON.parse(lines[0]!.trim());
    expect(logged.password).toBe("[REDACTED]");
    expect(logged.email).toBe("a@example.com");
  });

  test("maskerar personnummer och tokens", () => {
    const { lines, destination } = captureDestination();
    const logger = createLogger("billing", {}, destination);

    logger.info(
      {
        pnr: "19850101-2389",
        pnrHash: "abc123",
        refreshToken: "shhh",
        nested: { accessToken: "also-shhh" },
      },
      "test",
    );

    const logged = JSON.parse(lines[0]!.trim());
    expect(logged.pnr).toBe("[REDACTED]");
    expect(logged.pnrHash).toBe("[REDACTED]");
    expect(logged.refreshToken).toBe("[REDACTED]");
    expect(logged.nested.accessToken).toBe("[REDACTED]");
  });

  test("loggar övriga fält oförändrat", () => {
    const { lines, destination } = captureDestination();
    const logger = createLogger("payments", {}, destination);

    logger.info({ invoiceId: 42, status: "matched" }, "test");

    const logged = JSON.parse(lines[0]!.trim());
    expect(logged.invoiceId).toBe(42);
    expect(logged.status).toBe("matched");
  });

  test("sätter service-namnet i varje rad", () => {
    const { lines, destination } = captureDestination();
    const logger = createLogger("documents", {}, destination);

    logger.info("hej");

    const logged = JSON.parse(lines[0]!.trim());
    expect(logged.name).toBe("documents");
  });

  test("REDACT_PATHS innehåller de känsliga fälten från domain.md #19", () => {
    for (const field of ["password", "token", "refreshToken", "pnr", "pnrHash", "clientSecret"]) {
      expect(REDACT_PATHS.some((p) => p === field || p === `*.${field}`)).toBe(true);
    }
  });
});

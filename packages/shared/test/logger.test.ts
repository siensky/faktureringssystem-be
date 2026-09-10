import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { SENSITIVE_KEYS, createLogger, deepRedact } from "../src/logger";

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
  test("maskerar password på toppnivå", () => {
    const { lines, destination } = captureDestination();
    const logger = createLogger("auth", {}, destination);

    logger.info({ email: "a@example.com", password: "hemligt123" }, "login attempt");

    const logged = JSON.parse(lines[0]!.trim());
    expect(logged.password).toBe("[REDACTED]");
    expect(logged.email).toBe("a@example.com");
  });

  test("maskerar känsliga fält djupt nästlade, inte bara på nivå 0–1", () => {
    const { lines, destination } = captureDestination();
    const logger = createLogger("billing", {}, destination);

    logger.info(
      {
        pnr: "19850101-2389",
        outer: { middle: { inner: { pnr: "19850101-2389", refreshToken: "shhh" } } },
        list: [{ deep: { password: "nope" } }],
      },
      "test",
    );

    const logged = JSON.parse(lines[0]!.trim());
    expect(logged.pnr).toBe("[REDACTED]");
    expect(logged.outer.middle.inner.pnr).toBe("[REDACTED]");
    expect(logged.outer.middle.inner.refreshToken).toBe("[REDACTED]");
    expect(logged.list[0].deep.password).toBe("[REDACTED]");
  });

  test("maskerar Authorization- och Cookie-headers oavsett var de sitter", () => {
    const { lines, destination } = captureDestination();
    const logger = createLogger("auth", {}, destination);

    logger.info({ req: { headers: { authorization: "Bearer abc", host: "x" } } }, "test");

    const logged = JSON.parse(lines[0]!.trim());
    expect(logged.req.headers.authorization).toBe("[REDACTED]");
    expect(logged.req.headers.host).toBe("x");
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
});

describe("deepRedact", () => {
  test("täcker fältnamnen från domain.md #19", () => {
    for (const field of ["password", "token", "refreshToken", "pnr", "pnrHash", "clientSecret"]) {
      expect(SENSITIVE_KEYS.has(field.toLowerCase())).toBe(true);
    }
  });

  test("hanterar cirkulära referenser utan att kasta", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => deepRedact(obj)).not.toThrow();
  });

  test("lämnar primitiver orörda", () => {
    expect(deepRedact(42)).toBe(42);
    expect(deepRedact("hej")).toBe("hej");
    expect(deepRedact(null)).toBe(null);
  });
});

import { describe, expect, test } from "bun:test";
import { MissingEnvError, loadEnv, loadEnvWithDefaults, parseIntEnv } from "../src/config";

describe("loadEnv", () => {
  test("returnerar värden när alla nycklar finns", () => {
    const env = loadEnv(["PORT", "DATABASE_URL"] as const, {
      PORT: "4001",
      DATABASE_URL: "postgres://localhost/db",
    });
    expect(env.PORT).toBe("4001");
    expect(env.DATABASE_URL).toBe("postgres://localhost/db");
  });

  test("kastar MissingEnvError när en nyckel saknas", () => {
    expect(() => loadEnv(["PORT", "DATABASE_URL"] as const, { PORT: "4001" })).toThrow(
      MissingEnvError,
    );
  });

  test("behandlar tom sträng som saknad, inte som giltigt värde", () => {
    expect(() => loadEnv(["PORT"] as const, { PORT: "" })).toThrow(MissingEnvError);
  });

  test("felmeddelandet listar alla saknade nycklar, inte bara den första", () => {
    try {
      loadEnv(["A", "B", "C"] as const, { B: "ok" });
      throw new Error("skulle ha kastat");
    } catch (error) {
      expect(error).toBeInstanceOf(MissingEnvError);
      expect((error as MissingEnvError).missingKeys).toEqual(["A", "C"]);
    }
  });
});

describe("loadEnvWithDefaults", () => {
  test("använder default när miljön saknar värdet", () => {
    const env = loadEnvWithDefaults({ LOG_LEVEL: "info" }, {});
    expect(env.LOG_LEVEL).toBe("info");
  });

  test("miljövärdet vinner över defaulten", () => {
    const env = loadEnvWithDefaults({ LOG_LEVEL: "info" }, { LOG_LEVEL: "debug" });
    expect(env.LOG_LEVEL).toBe("debug");
  });
});

describe("parseIntEnv", () => {
  test("tolkar en giltig heltalssträng", () => {
    expect(parseIntEnv("PORT", "4001")).toBe(4001);
  });

  test("kastar tydligt fel på ogiltig indata", () => {
    expect(() => parseIntEnv("PORT", "inte-ett-tal")).toThrow(/PORT/);
  });
});

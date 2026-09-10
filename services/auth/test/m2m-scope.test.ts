import { describe, expect, test } from "bun:test";
import { resolveGrantedScopes } from "../src/m2m/services";

describe("resolveGrantedScopes", () => {
  const allowed = ["a:read", "a:write", "b:read"];

  test("beviljar skärningen av begärt och tillåtet", () => {
    expect(resolveGrantedScopes(["a:read", "b:read"], allowed)).toEqual(["a:read", "b:read"]);
  });

  test("filtrerar bort scopes som inte är tillåtna", () => {
    expect(resolveGrantedScopes(["a:read", "c:admin"], allowed)).toEqual(["a:read"]);
  });

  test("tom lista när inget begärt scope är tillåtet", () => {
    expect(resolveGrantedScopes(["c:admin", "d:x"], allowed)).toEqual([]);
  });

  test("bevarar ordningen från begäran", () => {
    expect(resolveGrantedScopes(["b:read", "a:read"], allowed)).toEqual(["b:read", "a:read"]);
  });
});

import { describe, expect, test } from "bun:test";
import { InternalError, type RequestContext, TenantScopedRepository } from "../src";

class Probe extends TenantScopedRepository {
  read(): number {
    return this.tenantId;
  }
}

const ctx = (over: Partial<RequestContext>): RequestContext => ({
  userId: 1,
  tenantId: 7,
  role: "admin",
  correlationId: "c",
  ...over,
});

describe("TenantScopedRepository", () => {
  test("returnerar tenantId när kontexten har det", () => {
    expect(new Probe(ctx({})).read()).toBe(7);
  });

  test("kastar InternalError när tenantId saknas — failar stängt", () => {
    expect(() => new Probe(ctx({ tenantId: undefined })).read()).toThrow(InternalError);
  });

  test("kastar även vid NaN", () => {
    expect(() => new Probe(ctx({ tenantId: Number.NaN })).read()).toThrow(InternalError);
  });
});

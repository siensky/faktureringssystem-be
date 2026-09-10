import { describe, expect, test } from "bun:test";
import { hashRequest } from "../src/idempotency";

describe("hashRequest", () => {
  test("oberoende av nyckelordning", () => {
    expect(hashRequest({ a: 1, b: 2 })).toBe(hashRequest({ b: 2, a: 1 }));
  });

  test("oberoende av nyckelordning djupt i strukturen", () => {
    expect(hashRequest({ x: { p: 1, q: [{ m: 1, n: 2 }] } })).toBe(
      hashRequest({ x: { q: [{ n: 2, m: 1 }], p: 1 } }),
    );
  });

  test("olika body ger olika hash", () => {
    expect(hashRequest({ amount: 100 })).not.toBe(hashRequest({ amount: 101 }));
  });

  test("array-ordning är signifikant", () => {
    expect(hashRequest([1, 2, 3])).not.toBe(hashRequest([3, 2, 1]));
  });

  test("undefined-fält påverkar inte hashen", () => {
    expect(hashRequest({ a: 1, b: undefined })).toBe(hashRequest({ a: 1 }));
  });
});

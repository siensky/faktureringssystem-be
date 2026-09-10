import { describe, expect, test } from "bun:test";
import {
  BadRequest,
  BaseError,
  Conflict,
  Forbidden,
  InternalError,
  NotFound,
  TooManyRequests,
  Unauthorized,
  UnprocessableEntity,
} from "../src/errors";

describe("BaseError-subklasser", () => {
  const cases: [typeof BaseError, number][] = [
    [InternalError, 500],
    [Unauthorized, 401],
    [BadRequest, 400],
    [NotFound, 404],
    [Forbidden, 403],
    [Conflict, 409],
    [TooManyRequests, 429],
    [UnprocessableEntity, 422],
  ];

  for (const [ErrorClass, expectedStatus] of cases) {
    test(`${ErrorClass.name} har statusCode ${expectedStatus}`, () => {
      // @ts-expect-error abstrakt konstruktor, men subklasserna är konkreta
      const err = new ErrorClass();
      expect(err.statusCode).toBe(expectedStatus);
      expect(err).toBeInstanceOf(BaseError);
      expect(err).toBeInstanceOf(Error);
    });
  }

  test("toPublicError() innehåller aldrig full_error", () => {
    const err = new InternalError("Något gick fel", { sql: "SELECT * FROM users", stack: "..." });
    const publicError = err.toPublicError();
    expect(publicError).toEqual({ success: false, code: 500, message: "Något gick fel" });
    expect(JSON.stringify(publicError)).not.toContain("SELECT");
  });

  test("full_error finns kvar på instansen för loggning", () => {
    const original = { detail: "internal detail" };
    const err = new InternalError("Något gick fel", original);
    expect(err.full_error).toBe(original);
  });
});

// BaseError-hierarkin. Flyttad oförändrad i sak från src/error/error.ts —
// se code-style.md #11–15: alla fel är subklasser av BaseError, statuskoden
// kommer alltid därifrån, och felmeddelanden till klienten avslöjar inget
// internt (full_error är för loggen, toPublicError() för svaret).

export abstract class BaseError extends Error {
  abstract statusCode: number;
  full_error: unknown;
  params: Record<string, any>;

  constructor(message: string, params: Record<string, any> = {}, full_error: unknown = {}) {
    super(message);
    this.params = params;
    this.full_error = full_error;
  }

  toPublicError() {
    return {
      success: false,
      code: this.statusCode,
      message: this.message,
    };
  }
}

export class InternalError extends BaseError {
  statusCode = 500;

  constructor(message = "Internal server Error", full_error = {}) {
    super(message, {}, full_error);
  }
}

export class Unauthorized extends BaseError {
  statusCode = 401;

  constructor(message = "You are not authorized", full_error = {}) {
    super(message, {}, full_error);
  }
}

export class BadRequest extends BaseError {
  statusCode = 400;

  constructor(
    message = "Invalid request, please send all the required fields as expected.",
    full_error = {},
  ) {
    super(message, {}, full_error);
  }
}

export class NotFound extends BaseError {
  statusCode = 404;

  constructor(message = "Not found", full_error = {}) {
    super(message, {}, full_error);
  }
}

export class Forbidden extends BaseError {
  statusCode = 403;

  constructor(message = "Permission denied for this action", full_error = {}) {
    super(message, {}, full_error);
  }
}

export class Conflict extends BaseError {
  statusCode = 409;

  constructor(message = "Resource already exists", full_error = {}) {
    super(message, {}, full_error);
  }
}

export class TooManyRequests extends BaseError {
  statusCode = 429;

  constructor(message = "Too many requests, try later.", full_error = {}) {
    super(message, {}, full_error);
  }
}

// Tillagd i fas 0 för idempotens-flödet i fas 3: samma Idempotency-Key med
// annan request-body är ett klientfel, inte en lyckad replay. Se planens
// idempotensavsnitt punkt 3.
export class UnprocessableEntity extends BaseError {
  statusCode = 422;

  constructor(message = "Request could not be processed as sent", full_error = {}) {
    super(message, {}, full_error);
  }
}

export abstract class BaseError extends Error {
  abstract statusCode: number;
  full_error: unknown;
  params: Record<string, any>;

  constructor(
    message: string,
    params: Record<string, any> = {},
    full_error: unknown = {}
  ) {
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

  constructor(message: string = "Internal server Error", full_error = {}) {
    super(message, {}, full_error);
  }
}

export class Unauthorized extends BaseError {
  statusCode = 401;

  constructor(message: string = "You are not authorized", full_error = {}) {
    super(message, {}, full_error);
  }
}

export class BadRequest extends BaseError {
  statusCode = 400;

  constructor(
    message: string = "Invalid request, please send all the required fields as expected.",
    full_error = {}
  ) {
    super(message, {}, full_error);
  }
}

export class NotFound extends BaseError {
  statusCode = 404;

  constructor(message: string = "Not found", full_error = {}) {
    super(message, {}, full_error);
  }
}

export class Forbidden extends BaseError {
  statusCode = 403;

  constructor(
    message: string = "Permission denied for this action",
    full_error = {}
  ) {
    super(message, {}, full_error);
  }
}

export class Conflict extends BaseError {
  statusCode = 409;

  constructor(message: string = "Resource already exists", full_error = {}) {
    super(message, {}, full_error);
  }
}

export class TooManyRequests extends BaseError {
  statusCode = 429;

  constructor(
    message: string = "Too many requests, try later.",
    full_error = {}
  ) {
    super(message, {}, full_error);
  }
}

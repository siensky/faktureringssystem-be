import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { BaseError, InternalError } from "./index";

// Fastifys globala felhanterare. Samma beteende som tidigare src/error/errorHandler.ts,
// men loggar via den delade pino-loggern (med maskering) i stället för console.error,
// och tar en logger-instans så varje tjänst kan skicka in sin egen med rätt service-namn.
// Samma skäl till "any" som i health/index.ts: bara Logger-generic-parametern
// vidgas, inte typsäkerheten i övrigt — code-style.md #16.
export function registerErrorHandler(
  fastify: FastifyInstance<any, any, any, any, any>,
  logger: Logger,
) {
  fastify.setErrorHandler((error: any, request, reply) => {
    logger.error(
      { err: error, correlationId: (request.headers["x-correlation-id"] as string) ?? undefined },
      error?.message ?? "Unhandled error",
    );

    if (error instanceof BaseError) {
      return reply.status(error.statusCode).send(error.toPublicError());
    }

    // Fastifys egen validering (t.ex. ett route-schema som inte matchar)
    // kastar ett fel med statusCode men är ingen BaseError. Den är ändå
    // klientens fel, inte ett internt fel — visa den, men fortfarande utan
    // stack trace eller interna detaljer i svaret.
    if (
      typeof error?.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.status(error.statusCode).send({
        success: false,
        code: error.statusCode,
        message: error.message ?? "Invalid request",
      });
    }

    const unknownError = new InternalError("Unknown error", error);
    return reply.status(unknownError.statusCode).send(unknownError.toPublicError());
  });
}

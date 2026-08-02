import { BaseError, InternalError } from "./error";
import type { FastifyInstance } from "fastify";

export default function errorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: any , _request, reply) => {

    console.error(`Message: ${error.message}`);
    console.error(`Stack: ${error.stack}`); 

    if (error instanceof BaseError) {
      const publicError = error.toPublicError();

      return reply.status(error.statusCode).send(publicError);
    }

    const unknownError = new InternalError("Unknown error", error);

    return reply
      .status(unknownError.statusCode)
      .send(unknownError.toPublicError());
  });
}

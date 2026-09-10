import type { FastifyReply, FastifyRequest } from "fastify";
import type { M2mService } from "./services";

interface TokenBody {
  grant_type: "client_credentials";
  client_id: string;
  client_secret: string;
  scope?: string;
}

export function createM2mControllers(service: M2mService) {
  return {
    async token(req: FastifyRequest<{ Body: TokenBody }>, reply: FastifyReply) {
      const result = await service.issueToken(
        req.body.client_id,
        req.body.client_secret,
        req.body.scope,
      );
      return reply.send(result);
    },
  };
}

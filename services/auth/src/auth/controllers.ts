// Plockar isär requesten, anropar servicen, formar svaret (code-style.md
// #2). Ingen affärslogik. correlationId plockas från headern om den finns,
// annars genererar servicen en.

import { contextOf } from "@faktura/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "./services";
import type { LoginInput, RegisterInput, TokenType } from "./types";

const cid = (req: FastifyRequest) =>
  (req.headers["x-correlation-id"] as string | undefined) ?? undefined;

export function createAuthControllers(service: AuthService) {
  return {
    async register(req: FastifyRequest<{ Body: RegisterInput }>, reply: FastifyReply) {
      const result = await service.register(req.body, cid(req));
      return reply.status(201).send(result);
    },

    async verifyEmail(req: FastifyRequest<{ Body: { token: string } }>, reply: FastifyReply) {
      return reply.send(await service.verifyEmail(req.body.token));
    },

    async login(req: FastifyRequest<{ Body: LoginInput }>, reply: FastifyReply) {
      return reply.send(await service.login(req.body));
    },

    async me(req: FastifyRequest, reply: FastifyReply) {
      return reply.send(await service.me(contextOf(req)));
    },

    async refresh(req: FastifyRequest<{ Body: { refreshToken: string } }>, reply: FastifyReply) {
      return reply.send(await service.refresh(req.body.refreshToken));
    },

    async logout(req: FastifyRequest<{ Body: { refreshToken: string } }>, reply: FastifyReply) {
      return reply.send(await service.logout(req.body.refreshToken));
    },

    async forgotPassword(req: FastifyRequest<{ Body: { email: string } }>, reply: FastifyReply) {
      return reply.send(await service.forgotPassword(req.body.email, cid(req)));
    },

    async resetPassword(
      req: FastifyRequest<{ Body: { token: string; newPassword: string } }>,
      reply: FastifyReply,
    ) {
      return reply.send(
        await service.resetPassword(req.body.token, req.body.newPassword, cid(req)),
      );
    },

    async devToken(
      req: FastifyRequest<{ Querystring: { email: string; type: Exclude<TokenType, "refresh"> } }>,
      reply: FastifyReply,
    ) {
      return reply.send(await service.issueDevToken(req.query.email, req.query.type));
    },
  };
}

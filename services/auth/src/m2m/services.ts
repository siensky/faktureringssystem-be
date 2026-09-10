// OAuth2 client_credentials: utfärda ett tjänste-token. Endast de scopes
// klienten både begär OCH har i allowed_scopes beviljas (architecture.md
// #18, minsta möjliga scope). `scope` är OBLIGATORISKT — en klient som
// utelämnar det ska INTE få allt, den ska få ett fel.

import { BadRequest, SERVICE_TOKEN, Unauthorized, signServiceToken } from "@faktura/shared";

import type { Sql } from "postgres";
import type { config as Config } from "../config";
import { verifyPassword } from "../passwords";
import { createM2mRepository } from "./repository";

/**
 * Skärningen mellan begärda och tillåtna scopes (architecture.md #18).
 * Ren funktion, enhetstestad separat.
 */
export function resolveGrantedScopes(requested: string[], allowed: string[]): string[] {
  return requested.filter((s) => allowed.includes(s));
}

export function createM2mService(deps: { sql: Sql; config: typeof Config }) {
  const repo = createM2mRepository(deps.sql);

  return {
    async issueToken(clientId: string, clientSecret: string, requestedScope?: string) {
      const client = await repo.findServiceClient(clientId);
      // Verifiera alltid mot något (konstant svarstid) och ge samma fel
      // oavsett om klienten finns eller hemligheten är fel.
      const hash =
        client?.client_secret_hash ??
        "$argon2id$v=19$m=65536,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const ok = await verifyPassword(clientSecret, hash);
      if (!client || !ok) {
        throw new Unauthorized("Ogiltig client_id eller client_secret");
      }

      const requested = requestedScope?.split(" ").filter(Boolean) ?? [];
      if (requested.length === 0) {
        throw new BadRequest("scope krävs (mellanslagsseparerad lista)");
      }
      const granted = resolveGrantedScopes(requested, client.allowed_scopes);
      if (granted.length === 0) {
        // Alla begärda scopes nekades -> invalid_scope, inte ett token med
        // tom scope.
        throw new BadRequest("invalid_scope: inget av de begärda scopen är tillåtet");
      }

      const accessToken = await signServiceToken(
        { clientId: client.client_id, scope: granted.join(" ") },
        deps.config.jwtServiceSecret,
      );
      return {
        access_token: accessToken,
        token_type: "Bearer" as const,
        expires_in: SERVICE_TOKEN.ttlSeconds,
        scope: granted.join(" "),
      };
    },
  };
}

export type M2mService = ReturnType<typeof createM2mService>;

// OAuth2 client_credentials: utfärda ett tjänste-token. Endast de scopes
// klienten både begär OCH har i allowed_scopes beviljas (architecture.md
// #18, minsta möjliga scope). Begärs inget scope beviljas alla tillåtna.

import { SERVICE_TOKEN, Unauthorized, signServiceToken } from "@faktura/shared";
import type { Sql } from "postgres";
import type { config as Config } from "../config";
import { verifyPassword } from "../passwords";
import { createM2mRepository } from "./repository";

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
      const granted =
        requested.length === 0
          ? client.allowed_scopes
          : requested.filter((s) => client.allowed_scopes.includes(s));

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

// ALL affärslogik för auth-modulen (code-style.md #2). Ingen HTTP här —
// metoderna kastar BaseError-subklasser, controllern/felhanteraren
// översätter (code-style.md #5).

import { randomUUID } from "node:crypto";
import {
  BadRequest,
  Forbidden,
  NotFound,
  USER_TOKEN,
  Unauthorized,
  signAccessToken,
} from "@faktura/shared";
import type { Logger } from "@faktura/shared";
import type Redis from "ioredis";
import type { Sql } from "postgres";
import { writeAuditLog } from "../audit";
import type { config as Config } from "../config";
import { SERVICE_NAME } from "../config";
import { writeEvent } from "../outbox";
import { generateToken, hashPassword, hashToken, verifyPassword } from "../passwords";
import { assertNotLockedOut, clearLoginFailures, recordLoginFailure } from "../throttle";
import { OK, toTokenPairResponse } from "./mappers";
import { createAuthRepository } from "./repository";
import type { LoginInput, RegisterInput, TenantStatus, TokenType } from "./types";

interface Deps {
  sql: Sql;
  redis: Redis;
  config: typeof Config;
  logger: Logger;
}

const norm = (email: string) => email.trim().toLowerCase();

export function createAuthService(deps: Deps) {
  const { sql, redis, config, logger } = deps;
  const repo = createAuthRepository(sql);

  // Argon2-hash att verifiera mot när användaren inte finns, så svarstiden
  // inte skvallrar om en e-post existerar (planens enumereringsskydd).
  let dummyHash: string | undefined;
  const getDummyHash = async (): Promise<string> => {
    if (!dummyHash) dummyHash = await hashPassword(randomUUID());
    return dummyHash;
  };

  const ttlFor = (type: TokenType): number =>
    type === "email_verification"
      ? config.emailVerificationTtlSeconds
      : config.passwordResetTtlSeconds;

  async function issueTokenRow(
    userId: number,
    tenantId: number,
    type: TokenType,
    ttlSeconds: number,
    db: Parameters<typeof repo.insertToken>[0] = sql,
  ): Promise<string> {
    const plain = generateToken();
    await repo.insertToken(db, {
      tenantId,
      userId,
      tokenType: type,
      tokenHash: hashToken(plain, config.tokenPepper),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    });
    return plain;
  }

  async function assertTenantActive(tenantId: number): Promise<void> {
    const status: TenantStatus | undefined = await repo.getTenantStatus(tenantId);
    if (status !== "active") {
      // Kallaren ÄR rätt identifierad men saknar behörighet -> 403, inte 404
      // (code-style.md #14).
      throw new Forbidden("Kontot är avstängt");
    }
  }

  return {
    async register(input: RegisterInput, correlationId?: string) {
      const email = norm(input.email);
      const passwordHash = await hashPassword(input.password);

      const taken =
        (await repo.findUserByEmailAnyMethod(email)) !== undefined ||
        (await repo.orgNumberExists(input.orgNumber));

      // Enumeringssäkert: samma svar oavsett om e-post/orgnr redan finns.
      // Vi skapar bara om det är fritt.
      if (!taken) {
        await sql.begin(async (tx) => {
          const { tenantId, userId } = await repo.insertTenantAndAdmin(tx, {
            companyName: input.companyName,
            orgNumber: input.orgNumber,
            email,
            passwordHash,
          });
          await issueTokenRow(
            userId,
            tenantId,
            "email_verification",
            config.emailVerificationTtlSeconds,
            tx,
          );
          await writeEvent(tx, {
            sourceService: SERVICE_NAME,
            eventType: "tenant.created",
            tenantId,
            correlationId,
            payload: { tenantId, adminUserId: userId },
          });
          await writeAuditLog(tx, {
            tenantId,
            actorUserId: userId,
            action: "tenant.registered",
            resourceType: "tenant",
            resourceId: String(tenantId),
            correlationId,
          });
        });
      } else {
        logger.info(
          { email: "[present]" },
          "register: e-post eller orgnr redan taget, ingen åtgärd",
        );
      }

      return OK;
    },

    async verifyEmail(token: string) {
      const row = await repo.findToken(hashToken(token, config.tokenPepper), "email_verification");
      if (!row || row.used_at || row.expires_at.getTime() < Date.now()) {
        throw new BadRequest("Ogiltig eller utgången token");
      }
      await sql.begin(async (tx) => {
        await repo.markTokenUsed(tx, row.id);
        await repo.setEmailVerified(tx, row.user_id);
      });
      return OK;
    },

    async login(input: LoginInput) {
      const email = norm(input.email);
      await assertNotLockedOut(redis, email);

      const user = await repo.findUserByEmailForLogin(email);
      const hash = user?.password_hash ?? (await getDummyHash());
      const passwordOk = await verifyPassword(input.password, hash);

      if (!user || !passwordOk) {
        await recordLoginFailure(redis, email);
        throw new Unauthorized("Fel e-post eller lösenord");
      }
      if (!user.email_verified_at) {
        throw new Forbidden("E-postadressen är inte verifierad");
      }
      await assertTenantActive(user.tenant_id);
      await clearLoginFailures(redis, email);

      const accessToken = await signAccessToken(
        { userId: user.id, tenantId: user.tenant_id, role: user.role },
        config.jwtUserSecret,
      );
      const refreshToken = await issueTokenRow(
        user.id,
        user.tenant_id,
        "refresh",
        config.refreshTtlSeconds,
      );
      return toTokenPairResponse({
        accessToken,
        refreshToken,
        expiresIn: USER_TOKEN.ttlSeconds,
      });
    },

    async refresh(refreshToken: string) {
      const row = await repo.findToken(hashToken(refreshToken, config.tokenPepper), "refresh");
      if (!row) throw new Unauthorized("Ogiltigt token");

      if (row.used_at) {
        // Ett redan roterat refresh-token presenteras igen -> möjlig stöld.
        // Avsluta alla sessioner för användaren.
        await sql.begin((tx) => repo.revokeTokens(tx, row.user_id, "refresh"));
        throw new Unauthorized("Token återanvänt — alla sessioner avslutade");
      }
      if (row.expires_at.getTime() < Date.now()) {
        throw new Unauthorized("Token har gått ut");
      }

      const user = await repo.findUserById(row.user_id);
      if (!user) throw new Unauthorized("Användaren finns inte");
      await assertTenantActive(user.tenant_id);

      const newRefresh = await sql.begin(async (tx) => {
        await repo.markTokenUsed(tx, row.id);
        return issueTokenRow(user.id, user.tenant_id, "refresh", config.refreshTtlSeconds, tx);
      });
      const accessToken = await signAccessToken(
        { userId: user.id, tenantId: user.tenant_id, role: user.role },
        config.jwtUserSecret,
      );
      return toTokenPairResponse({
        accessToken,
        refreshToken: newRefresh,
        expiresIn: USER_TOKEN.ttlSeconds,
      });
    },

    async logout(refreshToken: string) {
      const row = await repo.findToken(hashToken(refreshToken, config.tokenPepper), "refresh");
      if (row && !row.used_at) {
        await repo.markTokenUsed(sql, row.id);
      }
      return OK;
    },

    async forgotPassword(rawEmail: string, correlationId?: string) {
      const email = norm(rawEmail);
      const user = await repo.findUserByEmailForLogin(email);
      // Gör alltid samma arbete (en hashning) så svarstiden inte skvallrar.
      await hashPassword(randomUUID());

      if (user) {
        await sql.begin(async (tx) => {
          await repo.revokeTokens(tx, user.id, "password_reset");
          await issueTokenRow(
            user.id,
            user.tenant_id,
            "password_reset",
            config.passwordResetTtlSeconds,
            tx,
          );
          await writeAuditLog(tx, {
            tenantId: user.tenant_id,
            actorUserId: user.id,
            action: "password.reset_requested",
            resourceType: "user",
            resourceId: String(user.id),
            correlationId,
          });
        });
      }
      return OK;
    },

    async resetPassword(token: string, newPassword: string, correlationId?: string) {
      const row = await repo.findToken(hashToken(token, config.tokenPepper), "password_reset");
      if (!row || row.used_at || row.expires_at.getTime() < Date.now()) {
        throw new BadRequest("Ogiltig eller utgången token");
      }
      const passwordHash = await hashPassword(newPassword);
      await sql.begin(async (tx) => {
        await repo.markTokenUsed(tx, row.id);
        await repo.updatePassword(tx, row.user_id, passwordHash);
        // Lösenordsbyte ogiltigförklarar alla sessioner och andra
        // återställningslänkar (planens fas 1-beskrivning).
        await repo.revokeTokens(tx, row.user_id, "refresh");
        await repo.revokeTokens(tx, row.user_id, "password_reset");
        await writeAuditLog(tx, {
          tenantId: row.tenant_id,
          actorUserId: row.user_id,
          action: "password.reset",
          resourceType: "user",
          resourceId: String(row.user_id),
          correlationId,
        });
      });
      return OK;
    },

    /** Dev-only: utfärdar och RETURNERAR en färsk token i klartext, som
     *  ersättning för mejlet som documents skickar först i fas 4. */
    async issueDevToken(rawEmail: string, type: Exclude<TokenType, "refresh">) {
      if (!config.devEndpointsEnabled) {
        throw new NotFound("Not found");
      }
      const email = norm(rawEmail);
      const user = await repo.findUserByEmailAnyMethod(email);
      if (!user) throw new NotFound("Ingen användare med den e-posten");
      const token = await issueTokenRow(user.id, user.tenant_id, type, ttlFor(type));
      return { token };
    },

    // Exponeras för verifieringstester.
    _repo: repo,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

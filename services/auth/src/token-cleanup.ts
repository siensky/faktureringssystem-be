// Fas 6 (PLAN.md): "städa utgångna user_tokens" är en del av det dagliga
// automatiseringsjobbet i planen, men user_tokens ägs av AUTH
// (architecture.md, Tjänstegränser) — billing får aldrig skriva (eller
// DELETE:a) i en annans tjänsts tabell (architecture.md #1). Den här lilla
// egna cronen i auth gör därför precis den delen, i stället för att
// billings automation-modul skulle röra tabellen över tjänstegränsen.
//
// user_tokens_expiry_idx (migrations/0002_auth.js) finns redan sedan fas 1
// specifikt för den här frågan. Ingen skyddad manuell endpoint här — PLAN.md
// fas 6 ber om en sådan för billings automatisering specifikt, och den här
// städningen är en enda global DELETE utan tenant-iteration eller
// affärslogik att behöva trigga om på begäran.

import { type Logger, acquireLock, releaseLock } from "@faktura/shared";
import type Redis from "ioredis";
import type { Sql } from "postgres";

const LOCK_KEY = "cron:auth:token-cleanup";
const LOCK_TTL_SECONDS = 3600;

async function cleanupExpiredUserTokens(sql: Sql): Promise<number> {
  const rows = await sql`DELETE FROM user_tokens WHERE expires_at < now()`;
  return rows.count;
}

export function createTokenCleanupRunner(opts: { sql: Sql; redis: Redis; logger: Logger }) {
  const { sql, redis, logger } = opts;

  return {
    async runOnce(): Promise<void> {
      const got = await acquireLock(redis, LOCK_KEY, LOCK_TTL_SECONDS);
      if (!got) {
        logger.info("token-cleanup: körning redan pågår, hoppar över (låst)");
        return;
      }
      try {
        const deleted = await cleanupExpiredUserTokens(sql);
        logger.info({ deleted }, "token-cleanup: utgångna user_tokens städade");
      } catch (error) {
        logger.error({ err: error }, "token-cleanup: kunde inte städa user_tokens");
      } finally {
        await releaseLock(redis, LOCK_KEY);
      }
    },
  };
}

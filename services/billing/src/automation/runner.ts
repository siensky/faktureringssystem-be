// Redis-låset runt EN körning (planens Idempotens #7: en ren optimering,
// inte garantin — se packages/shared/src/redis för varför). Delas av
// timer-triggade körningar (03:00 Europe/Stockholm) och den skyddade
// manuella endpointen, så de aldrig kör samtidigt och gör dubbelarbete.
// Låset släpps EXPLICIT efter en klar körning (lyckad eller inte) i
// stället för att bara låta TTL:en gå ut — annars skulle ett lyckat
// manuellt anrop blockera nästa i upp till en timme.

import { type Logger, acquireLock, releaseLock } from "@faktura/shared";
import type Redis from "ioredis";
import type { AutomationService } from "./service";
import type { AutomationRunSummary } from "./types";

const LOCK_KEY = "cron:billing:automation";
// Krascha-säkerhetsnät om processen dör mitt i en körning utan att hinna
// släppa låset — inte den normala vägen ut (den är releaseLock ovan).
const LOCK_TTL_SECONDS = 3600;

export type AutomationRunResult = { locked: true } | ({ locked: false } & AutomationRunSummary);

export function createAutomationRunner(opts: {
  redis: Redis;
  automation: AutomationService;
  logger: Logger;
}) {
  const { redis, automation, logger } = opts;

  return {
    async runOnce(): Promise<AutomationRunResult> {
      const got = await acquireLock(redis, LOCK_KEY, LOCK_TTL_SECONDS);
      if (!got) {
        logger.info("automation: körning redan pågår, hoppar över (låst)");
        return { locked: true };
      }
      try {
        const summary = await automation.runDaily();
        return { locked: false, ...summary };
      } finally {
        await releaseLock(redis, LOCK_KEY);
      }
    },
  };
}

export type AutomationRunner = ReturnType<typeof createAutomationRunner>;

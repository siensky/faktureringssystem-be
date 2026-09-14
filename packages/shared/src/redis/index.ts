// Redis-klient, delad av rate limiting (räknare måste vara gemensamma över
// instanser, annars ger tre repliker tre gånger så många försök innan
// någon blockeras — planens "Säkerhet: Rate limiting"), cron-lås (fas 6)
// och cache av tjänste-tokens (fas 2). Allt Redis lagrar är uttryckligen
// sådant som är ofarligt att tappa vid en omstart (se planens Beslut-tabell).

import Redis from "ioredis";

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    // @fastify/rate-limit kräver att lazyConnect INTE är satt (den vill ha
    // en redan uppkopplad klient), men vi vill ändå att en trasig
    // Redis-anslutning syns som ett fel vid uppstart snarare än att tyst
    // köa kommandon — maxRetriesPerRequest gör det.
    maxRetriesPerRequest: 3,
  });
}

/**
 * Cron-lås (fas 6, planens Idempotens #7): en ren OPTIMERING som slipper
 * dubbelarbete när ett dagligt jobb triggas två gånger nära i tid (t.ex.
 * schemaläggaren OCH ett manuellt anrop mot drift-endpointen). Ger INTE
 * "exakt en gång" — ett lås som löper ut mitt i jobbet ger fortfarande två
 * samtidiga körningar. Den riktiga garantin ligger i cronjobbets eget
 * urvalsvillkor och radlåsen det tar i databasen; ett tappat/kapat lås gör
 * jobbet dyrare, aldrig fel.
 *
 * SET NX — bara en klient kan sätta nyckeln medan den redan finns. Ingen
 * ägar-token/Lua-radering: en förlorad race om att RELEASE:a någon annans
 * (nya) lås efter att vårt eget TTL redan gått ut är exakt den accepterade
 * risken ovan, inte en korrekthetsbugg.
 */
export async function acquireLock(redis: Redis, key: string, ttlSeconds: number): Promise<boolean> {
  const result = await redis.set(key, "1", "EX", ttlSeconds, "NX");
  return result === "OK";
}

/** Släpper låset tidigt så en lyckad körning inte blockerar nästa i onödan. */
export async function releaseLock(redis: Redis, key: string): Promise<void> {
  await redis.del(key);
}

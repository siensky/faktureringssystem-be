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

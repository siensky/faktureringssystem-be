// Daglig schemaläggning med UTTALAD tidszon (database.md #12): ett jobb
// schemalagt "03:00" utan tidszon kör två gånger eller noll gånger vid
// DST-övergången. 03:00 i Europe/Stockholm är avsiktligt valt i planen
// eftersom den svenska övergången sker 02:00↔03:00 — 03:00 existerar
// därför exakt en gång varje dygn, även på de två dygn om året klockan
// ställs om (se testerna för de faktiska 2026-datumen).
//
// Ingen extern cron-biblioteks-beroende (architecture.md #24, "välj den
// tråkiga lösningen") — bara en setTimeout-loop, samma mönster som
// startOutboxPublisher.
//
// nextDailyRunAt/startDailyTimer exporteras generiskt från packages/shared
// och är i DAG bara anropade med hour: 3 (billing- och auth-cronen), ett
// klockslag som ALDRIG hamnar i en DST-lucka i Europe/Stockholm — det är
// precis poängen ovan. En framtida anropare som väljer ett annat klockslag
// (t.ex. 02:xx, som inte existerar den svenska vårdagen klockan ställs
// fram) skulle annars tyst få ett närmevärde tillbaka i stället för ett
// fel (kodgranskning PR #6, fynd 5). utcInstantForLocalWallTime failar
// därför STÄNGT: hittar fixpunktsiterationen ingen instans som verkligen
// läses tillbaka som den begärda lokala tiden, kastas ett tydligt fel i
// stället för att gissa.

import type { Logger } from "pino";

/**
 * UTC-tidpunkten för nästa gång klockan `hour`:00:00 (hel timme) inträffar
 * i `timeZone`. Ren funktion — testbar med en manipulerad klocka
 * (testing.md: "urvalslogik i cronjobb, med manipulerad klocka") utan
 * riktig väntan eller en riktig kalenderdag.
 *
 * Iterativ fixpunkt i stället för ett bibliotek: en tidszons UTC-offset är
 * styckvis konstant och ändras bara i heltalstimmar vid en DST-övergång,
 * så konvergens sker inom någon enstaka iteration oavsett tidszon.
 */
export function nextDailyRunAt(from: Date, hour: number, timeZone: string): Date {
  const parts = localParts(from, timeZone);
  const secondsOfDay = parts.hour * 3600 + parts.minute * 60 + parts.second;
  const targetSecondsOfDay = hour * 3600;

  let { year, month, day } = parts;
  if (secondsOfDay >= targetSecondsOfDay) {
    ({ year, month, day } = addOneUtcDay(year, month, day));
  }

  return utcInstantForLocalWallTime(year, month, day, hour, 0, 0, timeZone);
}

export interface DailyTimerOptions {
  timeZone: string;
  /** Lokal timme, 0–23, då jobbet ska köras. */
  hour: number;
  jobName: string;
  logger: Logger;
  run: () => Promise<void>;
}

export interface DailyTimer {
  stop(): void;
}

/**
 * Väntar till nästa `hour`:00 i `timeZone`, kör `run`, och räknar ut nästa
 * körning på nytt utifrån den verkliga klockan när jobbet är klart — ingen
 * ackumulerad drift av att bara lägga till 24h varje gång.
 */
export function startDailyTimer(opts: DailyTimerOptions): DailyTimer {
  const { timeZone, hour, jobName, logger, run } = opts;
  let running = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleNext = () => {
    if (!running) return;
    const next = nextDailyRunAt(new Date(), hour, timeZone);
    const delayMs = Math.max(0, next.getTime() - Date.now());
    timer = setTimeout(tick, delayMs);
  };

  const tick = async () => {
    if (!running) return;
    try {
      await run();
    } catch (error) {
      logger.error({ err: error, jobName }, "startDailyTimer: dagligt jobb kastade ett fel");
    } finally {
      scheduleNext();
    }
  };

  scheduleNext();

  return {
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsFormatterCache.set(timeZone, fmt);
  }
  return fmt;
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`localParts: saknar '${type}' i Intl-utdata`);
    // Intl kan ge "24" för midnatt trots hourCycle: h23 i vissa motorer.
    return part.value === "24" ? 0 : Number(part.value);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function addOneUtcDay(
  year: number,
  month: number,
  day: number,
): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

/**
 * UTC-instansen som motsvarar den GIVNA kalenderdagens lokala klockslag i
 * `timeZone`. Fixpunktsiteration: gissa (som om lokal tid = UTC), se vad
 * gissningen FAKTISKT blir i `timeZone`, och korrigera mellanskillnaden.
 * Offset ändras bara i heltalstimmar, så tre varv räcker med marginal.
 */
/**
 * Kastar om den begärda lokala tiden inte existerar i `timeZone` (t.ex.
 * 02:30 under en vår-DST-lucka) — se filhuvudet. En sådan tid mappar aldrig
 * tillbaka till exakt sig själv oavsett UTC-gissning (kalendern hoppar rakt
 * över den), så fixpunktsiterationen konvergerar aldrig till diff === 0 för
 * just det fallet — det är signalen att failas stängt på, i stället för att
 * tyst returnera en tid i närheten som INTE var den som begärdes.
 */
function utcInstantForLocalWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const targetWallMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let guessMs = targetWallMs;
  let converged = false;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guessMs), timeZone);
    const guessWallMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = targetWallMs - guessWallMs;
    if (diff === 0) {
      converged = true;
      break;
    }
    guessMs += diff;
  }
  if (!converged) {
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    const ss = String(second).padStart(2, "0");
    throw new Error(
      `nextDailyRunAt: ${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${hh}:${mm}:${ss} finns inte i ${timeZone} (troligen en DST-lucka)`,
    );
  }
  return new Date(guessMs);
}

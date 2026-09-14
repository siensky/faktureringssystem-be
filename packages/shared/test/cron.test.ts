import { describe, expect, test } from "bun:test";
import { nextDailyRunAt } from "../src/cron";

const STOCKHOLM = "Europe/Stockholm";

describe("nextDailyRunAt", () => {
  test("samma dag om klockan ännu inte slagit 03:00 lokal tid", () => {
    // 2026-01-15 01:00 UTC = 02:00 svensk vintertid (UTC+1) — före 03:00.
    const next = nextDailyRunAt(new Date("2026-01-15T01:00:00Z"), 3, STOCKHOLM);
    expect(next.toISOString()).toBe("2026-01-15T02:00:00.000Z"); // 03:00 CET
  });

  test("nästa dag om klockan redan passerat 03:00 lokal tid", () => {
    // 2026-01-15 10:00 UTC = 11:00 svensk vintertid — långt efter 03:00.
    const next = nextDailyRunAt(new Date("2026-01-15T10:00:00Z"), 3, STOCKHOLM);
    expect(next.toISOString()).toBe("2026-01-16T02:00:00.000Z"); // 03:00 CET nästa dag
  });

  test("sommartid: 03:00 CEST är UTC+2", () => {
    // 2026-07-01 01:00 UTC = 03:00 svensk sommartid — redan 03:00, så nästa
    // körning blir morgondagen.
    const next = nextDailyRunAt(new Date("2026-07-01T01:00:00Z"), 3, STOCKHOLM);
    expect(next.toISOString()).toBe("2026-07-02T01:00:00.000Z"); // 03:00 CEST nästa dag
  });

  // Svensk DST 2026 (samma datum som services/billing/test/dates.test.ts
  // använder): framåt 29 mars (02:00 CET -> 03:00 CEST), tillbaka 25
  // oktober (03:00 CEST -> 02:00 CET). 03:00 är avsiktligt valt i planen
  // eftersom klockslaget existerar EXAKT en gång i båda riktningarna.
  test("DST framåt (29 mars 2026): 03:00 existerar en gång, direkt efter hoppet", () => {
    // Strax innan hoppet, natten mellan 28:e och 29:e — 2026-03-29 00:30 UTC
    // = 01:30 CET, före 03:00 lokal tid (dagens 03:00 CEST inträffar först).
    const beforeJump = nextDailyRunAt(new Date("2026-03-29T00:30:00Z"), 3, STOCKHOLM);
    // 03:00 CEST 29 mars = 01:00 UTC (UTC+2, klockan har redan hoppat till CEST).
    expect(beforeJump.toISOString()).toBe("2026-03-29T01:00:00.000Z");

    // Efter att 03:00 den 29:e redan passerat: nästa blir 30 mars, CEST (UTC+2).
    const afterJump = nextDailyRunAt(new Date("2026-03-29T02:00:00Z"), 3, STOCKHOLM);
    expect(afterJump.toISOString()).toBe("2026-03-30T01:00:00.000Z");
  });

  test("DST bakåt (25 oktober 2026): 03:00 existerar en gång, som CET efter omställningen", () => {
    // Före omställningen samma dygn (klockan är fortfarande CEST,
    // UTC+2) — nästa 03:00 är den dagens, som infaller i CET (UTC+1)
    // eftersom 03:00 CEST OCH omställningspunkten sammanfaller.
    const beforeFallback = nextDailyRunAt(new Date("2026-10-25T00:30:00Z"), 3, STOCKHOLM);
    expect(beforeFallback.toISOString()).toBe("2026-10-25T02:00:00.000Z"); // 03:00 CET

    // Efter att 25:ans 03:00 redan passerat: nästa är 26 oktober, CET (UTC+1).
    const afterFallback = nextDailyRunAt(new Date("2026-10-25T05:00:00Z"), 3, STOCKHOLM);
    expect(afterFallback.toISOString()).toBe("2026-10-26T02:00:00.000Z");
  });

  test("månadsskifte hanteras korrekt", () => {
    // 2026-01-31 10:00 UTC = 11:00 CET, efter 03:00 -> nästa blir 1 februari.
    const next = nextDailyRunAt(new Date("2026-01-31T10:00:00Z"), 3, STOCKHOLM);
    expect(next.toISOString()).toBe("2026-02-01T02:00:00.000Z");
  });

  // Kodgranskning PR #6, fynd 5: hour: 3 hamnar aldrig i en DST-lucka i
  // Stockholm (det är hela poängen med valet), men funktionen är
  // exporterad generiskt. 02:00 den 29 mars 2026 existerar INTE — klockan
  // hoppar 02:00 CET -> 03:00 CEST rakt över den — så en framtida
  // anropare som (fel) väljer hour: 2 ska få ett tydligt fel, inte en
  // tyst-fel instans i närheten.
  test("kastar för ett klockslag som inte existerar (DST-luckan, hour: 2)", () => {
    expect(() => nextDailyRunAt(new Date("2026-03-28T12:00:00Z"), 2, STOCKHOLM)).toThrow();
  });
});

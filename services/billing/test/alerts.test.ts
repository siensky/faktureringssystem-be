// Kodgranskning PR #7, fynd 2+3: alerts/service.ts:s tre kontroller ska
// FÅNGA sina egna fel (aldrig avvisa sitt löfte) — det är den garantin,
// inte Promise.allSettled i sig, som gör att en trasig kontroll syns som
// ETT fel i svaret utan att dölja de andra två. Testar de tre rena
// funktionerna direkt med en godtycklig resolve/reject-callback — ingen
// Sql/ChannelModel/Redis/fetch behöver mockas.

import { describe, expect, test } from "bun:test";
import {
  checkDeadLetterQueue,
  checkOutboxDeadLetters,
  checkUnmatchedTransactions,
} from "../src/alerts/checks";

describe("checkDeadLetterQueue", () => {
  test("lyckad hämtning ger djupet", async () => {
    const result = await checkDeadLetterQueue(async () => 3);
    expect(result).toEqual({ depth: 3 });
  });

  test("ett kastat fel fångas — ger depth: 0 + error, avvisar aldrig", async () => {
    const result = await checkDeadLetterQueue(async () => {
      throw new Error("access refused");
    });
    expect(result.depth).toBe(0);
    expect(result.error).toBe("access refused");
  });

  test("ett icke-Error-kastat värde blir ändå en strängad error, inte en krasch", async () => {
    // Ett tredjepartsbibliotek kan avvisa med vad som helst, inte bara ett
    // Error-objekt — errorMessage ska hantera det utan att själv krascha.
    const result = await checkDeadLetterQueue(() =>
      Promise.reject("sträng, inte ett Error-objekt"),
    );
    expect(result).toEqual({ depth: 0, error: "sträng, inte ett Error-objekt" });
  });
});

describe("checkOutboxDeadLetters", () => {
  test("lyckad hämtning summerar och grupperar per source_service", async () => {
    const result = await checkOutboxDeadLetters(async () => [
      { source_service: "auth", n: 2 },
      { source_service: "billing", n: 5 },
    ]);
    expect(result).toEqual({
      count: 7,
      bySourceService: { auth: 2, billing: 5 },
    });
  });

  test("tomt resultat ger count 0 utan att kasta", async () => {
    const result = await checkOutboxDeadLetters(async () => []);
    expect(result).toEqual({ count: 0, bySourceService: {} });
  });

  test("ett kastat fel fångas — ger count: 0, tom gruppering + error", async () => {
    const result = await checkOutboxDeadLetters(async () => {
      throw new Error("connection terminated");
    });
    expect(result).toEqual({ count: 0, bySourceService: {}, error: "connection terminated" });
  });
});

describe("checkUnmatchedTransactions", () => {
  test("lyckad hämtning ger antalet", async () => {
    const result = await checkUnmatchedTransactions(async () => 4);
    expect(result).toEqual({ count: 4 });
  });

  test("ett kastat fel (t.ex. payments nere) fångas — ger count: 0 + error", async () => {
    const result = await checkUnmatchedTransactions(async () => {
      throw new Error("payments svarade 503");
    });
    expect(result).toEqual({ count: 0, error: "payments svarade 503" });
  });
});

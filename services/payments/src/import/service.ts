// Kör parsade BgMax-liknande rader SEKVENTIELLT genom matchningsmotorn
// (fas 5-planen avsnitt 6) — inte Promise.all, så en stor fil inte
// svämmar över billings S2S-endpoints med hundratals samtidiga anrop.
//
// Varje rads match()-anrop skriver FÖRST en 'pending'-rad (se
// matching/service.ts) och ringer SEDAN billing — går S2S-anropet fel
// för en enskild rad (billing nere mitt i en stor fil) fångas felet HÄR
// i stället för att avbryta hela importen: raden finns redan skriven
// (spårad, olöst) och resten av filen fortsätter bearbetas
// (PR-granskning fas 5, punkt 2 — samma resonemang som webhooken, men
// här måste loopen själv fånga felet i stället för att låta hela
// requesten falla).

import type { Logger } from "@faktura/shared";
import type { MatchingService } from "../matching/service";
import { type ParsedLine, parseBgmaxLike } from "./parser";

export interface ImportSummary {
  linesRead: number;
  transactionsWritten: number;
  duplicates: number;
  autoMatched: number;
  manualReview: number;
  /**
   * Rader vars pending-rad skrevs men vars BESLUT inte kunde fattas
   * (billing nere, fel scope, nätverk). Raden ligger kvar i status
   * 'pending' i databasen — en ny import av SAMMA fil (samma härledda
   * eller angivna externalId) löser den i stället för att skapa en
   * dubblett.
   */
  unresolved: number;
  /** Radfel: antingen ett parsningsfel eller ett olöst beslut (se unresolved ovan). */
  errors: Array<{ lineOrdinal: number; error: string }>;
}

export function createImportService(opts: { matchingService: MatchingService; logger: Logger }) {
  return {
    async importFile(fileText: string, correlationId: string): Promise<ImportSummary> {
      const lines = parseBgmaxLike(fileText);
      const summary: ImportSummary = {
        linesRead: lines.length,
        transactionsWritten: 0,
        duplicates: 0,
        autoMatched: 0,
        manualReview: 0,
        unresolved: 0,
        errors: [],
      };

      for (const line of lines) {
        if (!line.ok) {
          summary.errors.push({ lineOrdinal: line.lineOrdinal, error: line.error });
          opts.logger.warn(
            { lineOrdinal: line.lineOrdinal, raw: line.raw, error: line.error },
            "payments-import: hoppar över felformad rad",
          );
          continue;
        }

        let outcome: Awaited<ReturnType<MatchingService["match"]>>;
        try {
          outcome = await opts.matchingService.match({
            source: "bgmax",
            externalId: line.externalId,
            bankgiro: line.bankgiro,
            ocr: line.ocr,
            amountOre: line.amountOre,
            payerName: line.payerName,
            bookedAt: line.bookedAt,
            correlationId,
          });
        } catch (error) {
          summary.unresolved += 1;
          const message = error instanceof Error ? error.message : String(error);
          summary.errors.push({ lineOrdinal: line.lineOrdinal, error: message });
          opts.logger.error(
            { lineOrdinal: line.lineOrdinal, err: error },
            "payments-import: kunde inte lösa raden (pending kvarstår, löses av en ny import)",
          );
          continue;
        }

        if (outcome.kind === "duplicate") {
          summary.duplicates += 1;
          continue;
        }

        summary.transactionsWritten += 1;
        if (outcome.status === "matched") summary.autoMatched += 1;
        if (outcome.status === "manual_review") summary.manualReview += 1;
      }

      return summary;
    },
  };
}

export type ImportService = ReturnType<typeof createImportService>;
export type { ParsedLine };

// Kör parsade BgMax-liknande rader SEKVENTIELLT genom matchningsmotorn
// (fas 5-planen avsnitt 6) — inte Promise.all, så en stor fil inte
// svämmar över billings S2S-endpoints med hundratals samtidiga anrop.

import type { Logger } from "@faktura/shared";
import type { MatchingService } from "../matching/service";
import { type ParsedLine, parseBgmaxLike } from "./parser";

export interface ImportSummary {
  linesRead: number;
  transactionsWritten: number;
  duplicates: number;
  autoMatched: number;
  manualReview: number;
  errors: Array<{ lineOrdinal: number; error: string }>;
}

export function createImportService(opts: { matchingService: MatchingService; logger: Logger }) {
  return {
    async importFile(
      fileText: string,
      fileSha256: string,
      correlationId: string,
    ): Promise<ImportSummary> {
      const lines = parseBgmaxLike(fileText, fileSha256);
      const summary: ImportSummary = {
        linesRead: lines.length,
        transactionsWritten: 0,
        duplicates: 0,
        autoMatched: 0,
        manualReview: 0,
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

        const outcome = await opts.matchingService.match({
          source: "bgmax",
          externalId: line.externalId,
          bankgiro: line.bankgiro,
          ocr: line.ocr,
          amountOre: line.amountOre,
          payerName: line.payerName,
          bookedAt: line.bookedAt,
          correlationId,
        });

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

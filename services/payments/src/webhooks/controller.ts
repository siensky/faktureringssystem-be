// POST /webhooks/payment — den simulerade "bankens" inkommande betalnings-
// rapporter (planens Kontext-avsnitt: "mockbank", inget riktigt Bankgirot-
// API). Speglar services/documents/src/documents/webhooks.py:s
// email-status-webhook rakt av.
//
// Tre skydd (domain.md #24-25, planens Säkerhet: Webhooks):
//   1. Signaturen räknas över RÅ body, INNAN JSON parsas — så en trasig
//      JSON-kropp med fel signatur fortfarande ger 401, inte 400.
//   2. Replayskydd: tidsstämpeln måste ligga inom ±5 minuter.
//   3. Dedup: matchningsmotorns bank_transactions_dedup
//      (source='webhook:mockbank', external_id=body.id) — ingen separat
//      webhook-event-tabell behövs (till skillnad från documents
//      email_webhook_events), se fas 5-planen avsnitt 3.1.
//
// Svarar ALLTID 200 { status: 'accepted' | 'duplicate' } vid giltig
// signatur — läcker aldrig matchningsdetaljer till en anropare som bara
// bevisat sig med en giltig signatur, inget mer.

import { randomUUID } from "node:crypto";
import { BadRequest, type Logger, Unauthorized } from "@faktura/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { MatchingService } from "../matching/service";
import { timestampFresh, verifySignature } from "./signature";

interface WebhookBody {
  id: string;
  bankgiro: string;
  ocr?: string;
  amountOre: number;
  payerName?: string;
  bookedAt: string;
}

function isWebhookBody(value: unknown): value is WebhookBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.bankgiro === "string" &&
    v.bankgiro.length > 0 &&
    // ocr FÅR vara tomt eller saknas — en betalning utan referens är
    // det arketypiska unknown_ocr-fallet, inte ett formatfel
    // (PR-granskning fas 5, punkt 7). isValidOcr("") i matchningsmotorn
    // fångar det och dirigerar raden till manual_review, precis som ett
    // OCR med fel Luhn-siffra.
    (v.ocr === undefined || typeof v.ocr === "string") &&
    typeof v.amountOre === "number" &&
    Number.isInteger(v.amountOre) &&
    typeof v.bookedAt === "string" &&
    !Number.isNaN(Date.parse(v.bookedAt)) &&
    (v.payerName === undefined || typeof v.payerName === "string")
  );
}

export function createWebhookController(opts: {
  matchingService: MatchingService;
  webhookSecret: string;
  logger: Logger;
}) {
  return {
    async payment(request: FastifyRequest, reply: FastifyReply) {
      // Content-type-parsern i routes.ts lämnar body OPARSAD (rå Buffer) —
      // se den filens moduldoc för varför.
      const rawBody = request.body as Buffer;
      const signature = String(request.headers["x-signature"] ?? "");
      const timestamp = String(request.headers["x-timestamp"] ?? "");

      // 1. Signatur FÖRST, över rå body.
      if (!verifySignature({ secret: opts.webhookSecret, timestamp, rawBody, signature })) {
        throw new Unauthorized("Ogiltig signatur");
      }

      // 2. Replayfönster.
      if (!timestampFresh(timestamp, { now: Date.now() / 1000 })) {
        throw new BadRequest("Tidsstämpeln är utanför tillåtet fönster");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody.toString("utf8"));
      } catch {
        throw new BadRequest("Ogiltig JSON");
      }
      if (!isWebhookBody(parsed)) {
        throw new BadRequest("id, bankgiro, amountOre och bookedAt krävs");
      }
      if (parsed.amountOre <= 0) {
        // amount_ore > 0 är en DB-CHECK (migrations/0006_payments.js) —
        // en återföring/korrigering med noll- eller negativt belopp kan
        // inte representeras i bank_transactions under NÅGON status.
        // Riktig reverserings-hantering är ett domänbeslut utanför fas
        // 5:s scope, men avvisningen ska ALDRIG vara tyst (PR-granskning
        // fas 5, punkt 7, domain.md #14) — larma innan 400:an.
        opts.logger.error(
          { bankgiro: parsed.bankgiro, amountOre: parsed.amountOre, externalId: parsed.id },
          "LARM: webhook-betalning med amountOre <= 0 kan inte bokföras (reversering stöds inte i fas 5)",
        );
        throw new BadRequest("amountOre måste vara positivt");
      }

      const outcome = await opts.matchingService.match({
        source: "webhook:mockbank",
        externalId: parsed.id,
        bankgiro: parsed.bankgiro,
        ocr: parsed.ocr ?? "",
        amountOre: parsed.amountOre,
        payerName: parsed.payerName ?? null,
        bookedAt: new Date(parsed.bookedAt),
        correlationId: String(request.headers["x-correlation-id"] ?? randomUUID()),
      });

      return reply
        .status(200)
        .send({ status: outcome.kind === "duplicate" ? "duplicate" : "accepted" });
    },
  };
}

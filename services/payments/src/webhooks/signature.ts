// Ren signatur-/tidsfönsterlogik för POST /webhooks/payment. Speglar
// services/documents/src/documents/webhooks.py:s verify_signature/
// timestamp_fresh (domain.md #25, planens Säkerhet: Webhooks).

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * HMAC-SHA256 över "<timestamp>.<rå body>" — signaturbasen inkluderar
 * tidsstämpeln så den inte kan bytas ut fritt av en angripare som ändå
 * har ett gammalt giltigt (timestamp, signatur)-par.
 *
 * Jämförelsen är konstant-tid (timingSafeEqual), men bara när längderna
 * redan matchar — timingSafeEqual KASTAR annars, vilket utan skydd skulle
 * bli ett 500 i stället för ett 401 på en publik endpoint (samma klass av
 * fel som PR-granskning fas 4, punkt 22, fixade på Python-sidan för
 * icke-ASCII-headers). Att korta-cirkla på längdskillnad läcker inget:
 * ett giltigt HMAC-SHA256-hex har alltid exakt 64 tecken, så längden i
 * sig är redan känd/offentlig.
 */
export function verifySignature(opts: {
  secret: string;
  timestamp: string;
  rawBody: Buffer;
  signature: string;
}): boolean {
  const base = Buffer.concat([Buffer.from(opts.timestamp, "utf8"), Buffer.from("."), opts.rawBody]);
  const expectedHex = createHmac("sha256", opts.secret).update(base).digest("hex");
  const expected = Buffer.from(expectedHex, "utf8");
  const given = Buffer.from(opts.signature ?? "", "utf8");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/** ±toleranceSeconds runt now (sekunder sedan epoch). Replayskydd. */
export function timestampFresh(
  timestamp: string,
  opts: { now: number; toleranceSeconds?: number },
): boolean {
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return false;
  return Math.abs(opts.now - sentAt) <= tolerance;
}

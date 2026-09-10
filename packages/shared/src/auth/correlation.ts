// X-Correlation-Id kommer från klienten och är otillförlitlig. Den ska
// ändå ner i UUID-kolumner (event_outbox.correlation_id, audit_log). Så:
// använd headern om den är ett giltigt UUID, annars generera ett nytt.
// Aldrig kasta — ett trasigt correlation-id från en klient får inte
// stjälpa requesten (code-style.md #18: validera vid gränsen — här genom
// att sanera, inte avvisa).

import { randomUUID } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveCorrelationId(headerValue: unknown): string {
  if (typeof headerValue === "string" && UUID_RE.test(headerValue)) {
    return headerValue.toLowerCase();
  }
  return randomUUID();
}

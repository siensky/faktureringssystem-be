// Idempotens för skapande via API (architecture.md #10, planens
// idempotensavsnitt #3). Krävs på allt som förbrukar ett fakturanummer
// eller skapar en bokföringspost: POST /admin/invoices, /:id/send,
// /:id/credit, POST /admin/customers.
//
// Flöde:
//   1. Räkna en stabil hash av request-bodyn.
//   2. Gör anspråk på nyckeln (INSERT ... 'in_progress') i en EGEN
//      transaktion som committas direkt. Det är det som gör att en
//      samtidig dubblett kan få 409 medan den första fortfarande kör —
//      hade anspråket legat i samma transaktion som resursen hade den
//      andra requesten bara blockerat tyst till första committat.
//      (Medveten avvikelse från planens "i samma transaktion som
//      resursen", noterad i PR-beskrivningen.)
//   3. Kör själva arbetet i sin egen transaktion.
//   4. Vid lyckat: UPDATE nyckeln till 'completed' med svaret.
//      Vid fel: DELETE det egna 'in_progress'-anspråket och låt felet
//      bubbla — nästa försök får börja om rent.
//
// Krock på ett redan existerande anspråk:
//   completed + samma hash  -> spela upp det lagrade svaret oförändrat
//   completed + annan hash   -> 422 (samma nyckel, annan body = klientfel)
//   in_progress, färskt      -> 409 (en samtidig dubblett pågår)
//   in_progress, för gammalt -> ta över anspråket (processen som tog det
//                               kraschade sannolikt före UPDATE/DELETE)

import { createHash } from "node:crypto";
import { Conflict, InternalError, UnprocessableEntity } from "@faktura/shared";
import type { JsonValue } from "@faktura/shared";
import type { Sql, TransactionSql } from "postgres";

const TTL_HOURS = 24;
// Ett anspråk som stått 'in_progress' längre än så antas övergivet (processen
// dog mellan anspråket och completed/rollback). Väl tilltaget — en normal
// skapanderequest tar millisekunder.
const STALE_MINUTES = 10;

export interface IdempotencyOutcome {
  status: number;
  body: JsonValue;
}

interface IdempotencyRow {
  request_hash: string;
  state: "in_progress" | "completed";
  response_status: number | null;
  response_body: JsonValue | null;
  created_at: Date;
}

/** Stabil hash oberoende av nyckelordning i JSON-objektet. */
export function hashRequest(body: unknown): string {
  return createHash("sha256").update(canonicalize(body)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}

export interface WithIdempotencyArgs<T extends IdempotencyOutcome> {
  sql: Sql;
  tenantId: number;
  key: string;
  endpoint: string;
  requestBody: unknown;
  /** Utför arbetet. Får en transaktion; kastar vid fel. */
  run: (tx: TransactionSql) => Promise<T>;
}

export async function withIdempotency<T extends IdempotencyOutcome>(
  args: WithIdempotencyArgs<T>,
): Promise<IdempotencyOutcome & { replayed: boolean }> {
  const { sql, tenantId, key, endpoint, requestBody } = args;
  const requestHash = hashRequest(requestBody);

  const claimed = await claim(sql, tenantId, key, endpoint, requestHash);
  if (claimed.kind === "replay") {
    return { status: claimed.status, body: claimed.body, replayed: true };
  }

  try {
    const result = await sql.begin((tx) => args.run(tx as TransactionSql));
    await sql`
      UPDATE idempotency_keys
      SET state = 'completed', response_status = ${result.status}, response_body = ${sql.json(
        result.body,
      )}
      WHERE tenant_id = ${tenantId} AND key = ${key}
    `;
    return { status: result.status, body: result.body, replayed: false };
  } catch (error) {
    await sql`
      DELETE FROM idempotency_keys
      WHERE tenant_id = ${tenantId} AND key = ${key} AND state = 'in_progress'
    `;
    throw error;
  }
}

type ClaimResult = { kind: "fresh" } | { kind: "replay"; status: number; body: JsonValue };

async function claim(
  sql: Sql,
  tenantId: number,
  key: string,
  endpoint: string,
  requestHash: string,
): Promise<ClaimResult> {
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3600_000);
  const inserted = await sql`
    INSERT INTO idempotency_keys (tenant_id, key, endpoint, request_hash, state, expires_at)
    VALUES (${tenantId}, ${key}, ${endpoint}, ${requestHash}, 'in_progress', ${expiresAt})
    ON CONFLICT (tenant_id, key) DO NOTHING
  `;
  if (inserted.count === 1) return { kind: "fresh" };

  const [row] = await sql<IdempotencyRow[]>`
    SELECT request_hash, state, response_status, response_body, created_at
    FROM idempotency_keys
    WHERE tenant_id = ${tenantId} AND key = ${key}
    LIMIT 1
  `;
  if (!row) {
    // Extremt smalt race: raden städades bort mellan INSERT och SELECT.
    // Be klienten försöka igen hellre än att gissa.
    throw new Conflict("Idempotensnyckeln är i ett övergående läge, försök igen");
  }

  if (row.state === "completed") {
    if (row.request_hash !== requestHash) {
      throw new UnprocessableEntity("Idempotency-Key har redan använts med en annan request-body");
    }
    if (row.response_status === null) {
      throw new InternalError("Idempotensrad markerad completed utan lagrat svar");
    }
    return { kind: "replay", status: row.response_status, body: row.response_body ?? null };
  }

  // state === 'in_progress'
  const ageMs = Date.now() - row.created_at.getTime();
  if (ageMs < STALE_MINUTES * 60_000) {
    throw new Conflict("En identisk request pågår redan (Idempotency-Key)");
  }
  // Ta över det övergivna anspråket.
  const reclaimed = await sql`
    UPDATE idempotency_keys
    SET request_hash = ${requestHash}, endpoint = ${endpoint},
        created_at = now(), expires_at = ${expiresAt}
    WHERE tenant_id = ${tenantId} AND key = ${key} AND state = 'in_progress'
      AND created_at = ${row.created_at}
  `;
  if (reclaimed.count !== 1) {
    // Någon annan hann ta över samtidigt.
    throw new Conflict("En identisk request pågår redan (Idempotency-Key)");
  }
  return { kind: "fresh" };
}

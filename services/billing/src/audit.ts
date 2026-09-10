// Append-only granskningslogg (planens Domänmodell #7). Skrivs i SAMMA
// transaktion som ändringen den beskriver, så en rollback tar med sig
// loggraden. Aldrig personnummer, tokens eller belopp i klartext utöver
// det som redan står på fakturan (domain.md #19).
//
// Identisk i sak med services/auth/src/audit.ts — varje tjänst håller sin
// egen tunna wrapper i stället för att dela en modul för fyra rader SQL.

import type { JsonObject } from "@faktura/shared";
import type { Sql, TransactionSql } from "postgres";

export interface AuditEntry {
  tenantId: number | null;
  actorUserId?: number | null;
  actorService?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  correlationId?: string | null;
  metadata?: JsonObject;
}

export async function writeAuditLog(db: Sql | TransactionSql, entry: AuditEntry): Promise<void> {
  await db`
    INSERT INTO audit_log (
      tenant_id, actor_user_id, actor_service, action,
      resource_type, resource_id, correlation_id, metadata
    ) VALUES (
      ${entry.tenantId},
      ${entry.actorUserId ?? null},
      ${entry.actorService ?? null},
      ${entry.action},
      ${entry.resourceType},
      ${entry.resourceId ?? null},
      ${entry.correlationId ?? null},
      ${db.json(entry.metadata ?? {})}
    )
  `;
}

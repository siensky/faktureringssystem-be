// Append-only granskningslogg (planens Domänmodell #7). Skrivs i SAMMA
// transaktion som ändringen den beskriver, så en rollback tar med sig
// loggraden. Aldrig personnummer, tokens eller lösenord i metadata
// (domain.md #19).

import type { JsonObject } from "@faktura/shared";
import type { TransactionSql } from "postgres";

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

export async function writeAuditLog(tx: TransactionSql, entry: AuditEntry): Promise<void> {
  await tx`
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
      ${tx.json(entry.metadata ?? {})}
    )
  `;
}

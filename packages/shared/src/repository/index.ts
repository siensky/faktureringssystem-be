// Tenant-filtrerad bas för repository-lagret. architecture.md #14: all SQL
// går genom ett repository som lägger på tenant-filtret, och #13: tenant
// kommer aldrig från body/query/header på användar-endpoints.
//
// "Failar stängt" (planens Säkerhet-avsnitt): saknas tenant i kontexten
// KASTAS ett fel — filtret får aldrig tyst utebli. Skillnaden mellan
// `WHERE tenant_id IS NULL` (ofarligt, returnerar inget) och ett bortfallet
// filter (returnerar ALLA tenanters rader) är skillnaden mellan en bugg och
// en total läcka. Därför är `tenantId` en getter som kastar, inte ett
// fält som kan vara undefined.

import { InternalError } from "../errors";

export interface RequestContext {
  userId: number;
  tenantId: number;
  role: "admin" | "customer";
  /** Bara satt för role: "customer" (domain.md #32, två lager åtkomstkontroll). */
  customerId?: number;
  /** Följer med genom hela kedjan för spårbarhet (architecture.md #5). */
  correlationId: string;
}

export abstract class TenantScopedRepository {
  constructor(protected readonly ctx: RequestContext) {}

  /**
   * Tenant-id att filtrera på. Kastar om kontexten saknar det — då ska
   * ingen query köras alls, hellre ett 500 än en läcka.
   */
  protected get tenantId(): number {
    const id = this.ctx?.tenantId;
    if (id === undefined || id === null || Number.isNaN(id)) {
      throw new InternalError("Repository anropat utan tenant i RequestContext");
    }
    return id;
  }

  /**
   * Kund-id att filtrera på i portalen — samma "failar stängt"-princip som
   * tenantId (domain.md #32: rätt tenant OCH rätt kund). Bara portal-
   * repositoryn som byggs på en role: "customer"-kontext ska anropa den
   * här; en admin-kontext saknar customerId och ska aldrig fråga efter det.
   */
  protected get customerId(): number {
    const id = this.ctx?.customerId;
    if (id === undefined || id === null || Number.isNaN(id)) {
      throw new InternalError("Repository anropat utan customerId i RequestContext");
    }
    return id;
  }
}

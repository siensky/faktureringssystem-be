export interface TenantRunSummary {
  tenantId: number;
  overdueMarked: number;
  remindersCreated: number;
  recurringGenerated: number;
  errors: number;
}

export interface AutomationRunSummary {
  today: string;
  tenantsProcessed: number;
  overdueMarked: number;
  remindersCreated: number;
  recurringGenerated: number;
  idempotencyKeysDeleted: number;
  outboxRowsDeleted: number;
  tenantErrors: number;
}

// REST-form av GET /auth/me (fas 8). Delas mellan services/auth och
// apps/backoffice — ändrar auth-mappern sig bort från den här formen
// slutar den typechecka (code-style.md #19).

export type UserRole = "admin" | "customer";

/** Fas 12: ett av de företag en BankID-kundidentitet är länkad till (user_company_links). */
export interface CompanyLinkDto {
  tenantId: number;
  tenantName: string;
  customerId: number;
}

export interface CurrentUserDto {
  userId: number;
  tenantId: number;
  tenantName: string;
  email: string | null;
  role: UserRole;
  /** Fas 9: bara satt för role: "customer" — portalens egen kund-id. */
  customerId: number | null;
  /** Fas 12: bara satt för en BankID-kundidentitet med minst ett länkat företag. */
  companies?: CompanyLinkDto[];
}

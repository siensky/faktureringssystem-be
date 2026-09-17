// REST-form av GET /auth/me (fas 8). Delas mellan services/auth och
// apps/backoffice — ändrar auth-mappern sig bort från den här formen
// slutar den typechecka (code-style.md #19).

export type UserRole = "admin" | "customer";

export interface CurrentUserDto {
  userId: number;
  tenantId: number;
  tenantName: string;
  email: string | null;
  role: UserRole;
  /** Fas 9: bara satt för role: "customer" — portalens egen kund-id. */
  customerId: number | null;
}

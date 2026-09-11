/* eslint-disable */
/**
 * Denna fil är GENERERAD av packages/contracts/scripts/codegen.ts.
 * Ändra inte här — ändra motsvarande .schema.json och kör `bun run codegen`.
 */

/**
 * Payload för invoice.sent. Publiceras av billing i samma transaktion som POST /admin/invoices/:id/send sätter status sent och skriver snapshoten. Bara id:n (architecture.md #8) — documents hämtar snapshoten via GET /internal/invoices/:id/snapshot och renderar PDF ur den, aldrig ur de levande tabellerna.
 */
export interface InvoiceSentPayload {
  /**
   * Fakturan som skickades. Tenant står i envelopen, inte här.
   */
  invoiceId: number;
}

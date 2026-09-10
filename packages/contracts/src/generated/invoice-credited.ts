/* eslint-disable */
/**
 * Denna fil är GENERERAD av packages/contracts/scripts/codegen.ts.
 * Ändra inte här — ändra motsvarande .schema.json och kör `bun run codegen`.
 */

/**
 * Payload för invoice.credited. Publiceras av billing i samma transaktion som POST /admin/invoices/:id/credit skapar kreditfakturan i status settled och sätter originalet till credited. invoiceId är KREDITFAKTURAN — det är den som har en snapshot och som skickas till kunden som PDF (domain.md #35).
 */
export interface InvoiceCreditedPayload {
  /**
   * Kreditfakturans id.
   */
  invoiceId: number;
  /**
   * Originalfakturan som krediterades.
   */
  creditsInvoiceId: number;
}

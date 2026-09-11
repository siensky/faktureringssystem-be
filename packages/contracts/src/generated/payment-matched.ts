/* eslint-disable */
/**
 * Denna fil är GENERERAD av packages/contracts/scripts/codegen.ts.
 * Ändra inte här — ändra motsvarande .schema.json och kör `bun run codegen`.
 */

/**
 * Payload för payment.matched. Publiceras av payments när en inkommande banktransaktion helt täcker fakturans kvarstående belopp (amountOre == remainingOre). billing konsumerar eventet och skriver den faktiska raden i invoice_payments (architecture.md #20 — payments skriver aldrig billings tabeller direkt). Eventtypen är bara informativ: billing räknar alltid om paid_ore via SUM och avgör status='paid' från det, aldrig från eventnamnet.
 */
export interface PaymentMatchedPayload {
  /**
   * Aktuell faktura efter kedjeföljning av superseded_by_invoice_id — inte nödvändigtvis den faktura OCR:et ursprungligen pekade på.
   */
  invoiceId: number;
  /**
   * Beloppet som ska bokföras, i öre. Verifierat mot en LEVANDE remainingOre-läsning i payments innan eventet publicerades (domain.md #27).
   */
  amountOre: number;
  /**
   * Payments egen identitet för transaktionen ("<source>:<externalId>"), unik per rad i bank_transactions. Grunden för billings ON CONFLICT-dedup i invoice_payments.
   */
  paymentId: string;
  /**
   * Bankens egen bokföringstidpunkt för transaktionen (bank_transactions.booked_at), inte tidpunkten billing råkar hantera eventet. Utan den skulle invoice_payments.booked_at falla tillbaka på "när billing bearbetade eventet", vilket är fel data för en betalning som importeras dagar i efterhand.
   */
  bookedAt: string;
}

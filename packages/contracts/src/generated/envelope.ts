/* eslint-disable */
/**
 * Denna fil är GENERERAD av packages/contracts/scripts/codegen.ts.
 * Ändra inte här — ändra motsvarande .schema.json och kör `bun run codegen`.
 */

/**
 * Höljet runt varje affärshändelse som publiceras på RabbitMQ. Se rules/architecture.md, avsnittet Event. Systemhändelser (t.ex. ping i fas 0) använder INTE denna envelope — de är infrastrukturkontroller utan tenant, inte affärshändelser.
 */
export interface EventEnvelope {
  /**
   * Unikt per publicerad rad i event_outbox. Samma id vid en omsänd leverans — det är det som gör konsumentens deduplicering på (event_id, consumer) möjlig.
   */
  eventId: string;
  /**
   * <entitet>.<verb i dåtid>, t.ex. invoice.sent. Aldrig imperativ (send.email) — ett event beskriver något som har hänt.
   */
  eventType: string;
  /**
   * Obligatoriskt. Saknas det går eventet till dead-letter — gissas aldrig.
   */
  tenantId: number;
  /**
   * Följer med hela kedjan, satt vid första inkommande request och kopierad vidare i varje event och HTTP-anrop.
   */
  correlationId: string;
  /**
   * UTC-tidsstämpel för när händelsen faktiskt inträffade i affärslogiken, inte när den publicerades.
   */
  occurredAt: string;
  /**
   * Id:n, inte hela objekt. Konsumenten hämtar det den behöver via API.
   */
  payload: {};
}

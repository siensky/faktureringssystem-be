// `error` är satt när just DEN kontrollen inte gick att göra (t.ex.
// payments nere) — resten av svaret ska ändå levereras. En trasig
// enskild kontroll ska synas, inte dölja de andra två eller 500:a hela
// endpointen (fas 7, larm-endpointens syfte är precis att fungera under
// partiella driftstörningar).
export interface AlertsSummary {
  deadLetterQueue: { depth: number; error?: string };
  outboxDeadLetters: { count: number; bySourceService: Record<string, number>; error?: string };
  unmatchedTransactions: { count: number; error?: string };
}

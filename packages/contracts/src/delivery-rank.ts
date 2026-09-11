// Delad rangordning för invoices.delivery_status / email_outbox.status
// (domain.md #29). Läser schemas/delivery-status-rank.json — SAMMA fil
// som Python-sidan (services/documents/src/documents/delivery.py) läser —
// i stället för att hårdkoda ordningen separat i varje språk. Se filens
// $comment för resonemanget bakom ordningen.

import { loadSchema } from "./schema-loader";

interface DeliveryStatusRankData {
  order: readonly string[];
}

const { order } = loadSchema(
  "schemas/delivery-status-rank.json",
) as unknown as DeliveryStatusRankData;

export const DELIVERY_STATUS_ORDER = order as readonly string[];

const RANK: ReadonlyMap<string, number> = new Map(order.map((status, index) => [status, index]));

/** Kastar om status inte finns i den delade ordningen. */
export function deliveryRank(status: string): number {
  const rank = RANK.get(status);
  if (rank === undefined) {
    throw new Error(`okänd delivery-status: ${status}`);
  }
  return rank;
}

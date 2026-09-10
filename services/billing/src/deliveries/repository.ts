// ALL SQL för leveransstatus (database.md #22). Tenant-filtrerad via
// TenantScopedRepository — saknas tenant i kontexten kastar gettern (fail
// closed, architecture.md #21), även på den här interna konsument-vägen.
//
// invoices.delivery_status ägs av documents rapporter men bor i billings
// tabell, så billing är enda tjänsten som skriver den (architecture.md #1).
// Uppdateringen är MONOTON: ett försenat 'delivered' får aldrig skriva
// över ett 'bounced' (domain.md #29). Monotoniciteten uttrycks som ett
// rank-villkor i WHERE-satsen, så en förlorad kapplöpning helt enkelt
// träffar noll rader i stället för att kliva bakåt.

import { TenantScopedRepository } from "@faktura/shared";
import type { TransactionSql } from "postgres";
import type { DeliveryStatus } from "../invoices/types";

/**
 * Rank för monoton jämförelse. Terminala utfall (failed/bounced) ligger
 * högst så att inget "framsteg" kan skriva över dem; 'bounced' över
 * 'failed' eftersom en studs är ett starkare besked om adressen än ett
 * generiskt sändfel.
 */
const DELIVERY_RANK: Record<DeliveryStatus, number> = {
  none: 0,
  queued: 1,
  sent: 2,
  delivered: 3,
  failed: 4,
  bounced: 5,
};

export function deliveryRank(status: DeliveryStatus): number {
  return DELIVERY_RANK[status];
}

export class DeliveryRepository extends TenantScopedRepository {
  constructor(
    private readonly tx: TransactionSql,
    ctx: ConstructorParameters<typeof TenantScopedRepository>[0],
  ) {
    super(ctx);
  }

  /**
   * INSERT i processed_events för (event_id, 'billing'). Returnerar true om
   * raden var ny — false betyder att eventet redan hanterats (dubblett från
   * at-least-once), och anroparen ska då inte göra om jobbet. Fall A i
   * architecture.md #7: markering + jobb i SAMMA transaktion.
   */
  async markProcessed(eventId: string): Promise<boolean> {
    const rows = await this.tx`
      INSERT INTO processed_events (event_id, consumer)
      VALUES (${eventId}, 'billing')
      ON CONFLICT (event_id, consumer) DO NOTHING
    `;
    return rows.count === 1;
  }

  /**
   * Monoton uppdatering av delivery_status. Skriver bara om det nya
   * värdet rankas högre än det nuvarande. Returnerar antalet ändrade
   * rader (0 = fakturan saknas för tenanten, eller övergången var inte
   * ett framsteg).
   */
  async advanceDeliveryStatus(invoiceId: number, next: DeliveryStatus): Promise<number> {
    const rows = await this.tx`
      UPDATE invoices SET delivery_status = ${next}, updated_at = now()
      WHERE id = ${invoiceId} AND tenant_id = ${this.tenantId}
        AND CASE delivery_status
              WHEN 'none' THEN 0 WHEN 'queued' THEN 1 WHEN 'sent' THEN 2
              WHEN 'delivered' THEN 3 WHEN 'failed' THEN 4 WHEN 'bounced' THEN 5
            END < ${deliveryRank(next)}
    `;
    return rows.count;
  }

  /** Kundens id för en faktura, eller undefined om fakturan inte är tenantens. */
  async customerIdForInvoice(invoiceId: number): Promise<number | undefined> {
    const [row] = await this.tx<{ customer_id: number }[]>`
      SELECT customer_id FROM invoices
      WHERE id = ${invoiceId} AND tenant_id = ${this.tenantId} LIMIT 1
    `;
    return row?.customer_id;
  }

  /**
   * Hård studs stänger av framtida utskick till adressen (domain.md #23).
   * Mjuk studs rör den inte. Returnerar antalet ändrade rader.
   */
  async invalidateCustomerEmail(customerId: number): Promise<number> {
    const rows = await this.tx`
      UPDATE customers SET email_valid = false, updated_at = now()
      WHERE id = ${customerId} AND tenant_id = ${this.tenantId} AND email_valid = true
    `;
    return rows.count;
  }
}

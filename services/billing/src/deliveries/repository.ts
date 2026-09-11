// ALL SQL för leveransstatus (database.md #22). Tenant-filtrerad via
// TenantScopedRepository — saknas tenant i kontexten kastar gettern (fail
// closed, architecture.md #21), även på den här interna konsument-vägen.
//
// invoices.delivery_status ägs av documents rapporter men bor i billings
// tabell, så billing är enda tjänsten som skriver den (architecture.md #1).
// Uppdateringen är MONOTON: ett försenat 'delivered' får aldrig skriva
// över ett 'bounced' (domain.md #29), och inte heller nedgradera ett redan
// bekräftat 'delivered' till 'failed' (t.ex. ett ur ordning levererat
// webhook-event). Rangordningen är DELAD med documents (Python) via
// packages/contracts — se schemas/delivery-status-rank.json — i stället
// för en hårdkodad kopia i varje språk som kan glida isär tyst.
//
// array_position() på den delade ordningen ger rangen direkt i SQL:
// NULL < NULL = NULL (inte TRUE) om ett värde av någon anledning inte
// finns i listan, så jämförelsen failar STÄNGT (ingen skrivning) snarare
// än att krascha eller råka tillåta en okänd status.

import { DELIVERY_STATUS_ORDER, deliveryRank } from "@faktura/contracts";
import { TenantScopedRepository } from "@faktura/shared";
import type { TransactionSql } from "postgres";
import type { DeliveryStatus } from "../invoices/types";

export { deliveryRank };

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
    const order = [...DELIVERY_STATUS_ORDER];
    const rows = await this.tx`
      UPDATE invoices SET delivery_status = ${next}, updated_at = now()
      WHERE id = ${invoiceId} AND tenant_id = ${this.tenantId}
        AND array_position(${order}::text[], delivery_status)
            < array_position(${order}::text[], ${next})
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

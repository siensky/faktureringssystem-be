// Affärslogik för inkommande leveransrapporter från documents
// (invoice.delivery_updated). Ingen HTTP, ingen RabbitMQ här — bara "givet
// den här rapporten, vad ska hända i databasen".
//
// architecture.md #7 fall A: sidoeffekten är en skrivning i den EGNA
// databasen, så markeringen i processed_events och själva jobbet ligger i
// samma transaktion. Kraschar något rullas bådadera tillbaka och eventet
// får ett ärligt nytt försök.

import type { InvoiceDeliveryUpdatedPayload } from "@faktura/contracts";
import type { JsonObject, RequestContext } from "@faktura/shared";
import type { Sql } from "postgres";
import { writeAuditLog } from "../audit";
import { DeliveryRepository } from "./repository";

export interface DeliveryUpdate {
  eventId: string;
  tenantId: number;
  correlationId: string;
  payload: InvoiceDeliveryUpdatedPayload;
}

export interface DeliveryOutcome {
  /** false = eventet var redan hanterat (dubblett), inget gjordes. */
  applied: boolean;
  /** true om delivery_status faktiskt flyttades framåt. */
  statusAdvanced: boolean;
  /** true om en hård studs stängde av kundens adress. */
  emailInvalidated: boolean;
}

function ctxFor(tenantId: number, correlationId: string): RequestContext {
  // Konsumenten agerar för tenanten i envelopen — ingen inloggad användare.
  return { userId: 0, tenantId, role: "admin", correlationId };
}

export function createDeliveryService(sql: Sql) {
  return {
    async apply(update: DeliveryUpdate): Promise<DeliveryOutcome> {
      const { eventId, tenantId, correlationId, payload } = update;

      return sql.begin(async (tx) => {
        const repo = new DeliveryRepository(tx, ctxFor(tenantId, correlationId));

        const fresh = await repo.markProcessed(eventId);
        if (!fresh) {
          return { applied: false, statusAdvanced: false, emailInvalidated: false };
        }

        const advanced = await repo.advanceDeliveryStatus(
          payload.invoiceId,
          payload.deliveryStatus,
        );

        let emailInvalidated = false;
        if (payload.deliveryStatus === "bounced" && payload.bounceType === "hard") {
          const customerId = await repo.customerIdForInvoice(payload.invoiceId);
          if (customerId !== undefined) {
            emailInvalidated = (await repo.invalidateCustomerEmail(customerId)) > 0;
            if (emailInvalidated) {
              const metadata: JsonObject = { invoiceId: payload.invoiceId, reason: "hard_bounce" };
              await writeAuditLog(tx, {
                tenantId,
                actorService: "documents",
                action: "customer.email_invalidated",
                resourceType: "customer",
                resourceId: String(customerId),
                correlationId,
                metadata,
              });
            }
          }
        }

        return { applied: true, statusAdvanced: advanced > 0, emailInvalidated };
      });
    },
  };
}

export type DeliveryService = ReturnType<typeof createDeliveryService>;

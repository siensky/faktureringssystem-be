// Databasrad -> API-form. Personnumret lämnar ALDRIG API:t — varken
// krypterat eller i klartext (domain.md #19–20). hasPnr räcker för UI:t.

import type { CustomerDto } from "@faktura/contracts";
import type { CustomerRow } from "./types";

// Ingen explicit returtyp här (medvetet, avviker från code-style.md #19):
// funktionens returvärde flödar in i JsonValue-typade slots (idempotency.ts).
// Ett namngivet interface saknar implicit index-signatur och skulle bryta
// den typningen — `satisfies` ger samma kompileringsskydd (en mapper som
// glider bort från CustomerDto slutar typechecka) utan det problemet.
export function toView(row: CustomerRow) {
  return {
    id: row.id,
    customerType: row.customer_type,
    name: row.name,
    email: row.email,
    isEmailValid: row.email_valid,
    orgNumber: row.org_number,
    hasPnr: row.pnr_hmac !== null,
    address: {
      street: row.address_street,
      zip: row.address_zip,
      city: row.address_city,
    },
    paymentTermsDays: row.payment_terms_days,
    createdAt: row.created_at.toISOString(),
  } satisfies CustomerDto;
}

/** S2S-vy för documents (PDF-adressblock). Fortfarande inget personnummer. */
export function toInternalView(row: CustomerRow) {
  return {
    id: row.id,
    customerType: row.customer_type,
    name: row.name,
    email: row.email,
    orgNumber: row.org_number,
    address: {
      street: row.address_street,
      zip: row.address_zip,
      city: row.address_city,
    },
  };
}

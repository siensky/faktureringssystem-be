// S2S-läsning mot billing: POST /auth/customer-invites validerar att
// customerId faktiskt tillhör den inbjudande adminens tenant INNAN auth
// skriver en users-rad — annars skulle en admin kunna gissa sig till ett
// customerId hos en annan tenant och koppla en portal-inloggning till det.
// Tjänste-token hämtas via OAuth2 client_credentials och cachas i Redis
// tills strax före utgång — samma getServiceToken/mönster som
// services/payments/src/billing-client.ts och billing/src/alerts/service.ts.
//
// Ren läsning (architecture.md #20: skrivningar går aldrig via S2S-HTTP) —
// den här klienten skriver aldrig något i billing.

import { getServiceToken } from "@faktura/shared";
import type Redis from "ioredis";
import { config } from "./config";

export interface InternalCustomer {
  id: number;
  name: string;
  email: string;
}

export async function findCustomer(
  redis: Redis,
  tenantId: number,
  customerId: number,
  correlationId: string,
): Promise<InternalCustomer | undefined> {
  const token = await getServiceToken({
    authBaseUrl: config.authBaseUrl,
    clientId: config.authClientId,
    clientSecret: config.authClientSecret,
    redis,
    scopes: config.authClientScopes,
  });
  const res = await fetch(`${config.billingBaseUrl}/internal/customers/${customerId}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-tenant-id": String(tenantId),
      "x-correlation-id": correlationId,
    },
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`billing /internal/customers/:id svarade ${res.status}`);
  return (await res.json()) as InternalCustomer;
}

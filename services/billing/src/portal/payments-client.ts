// S2S-anrop mot payments: POST /internal/payments/stripe-checkout-sessions
// (fas 10). Samma getServiceToken/mönster som documents-client.ts i den
// här mappen och alerts/service.ts:s anrop till payments — BILLING_CLIENT_*
// återanvänds, med ett tredje scope utöver payments:ops:read (fas 7) och
// documents:pdf:read (fas 9).
//
// billing skickar bara invoiceId — INTE ett belopp. payments räknar fram
// en LEVANDE remainingOre själv via sin egen S2S-läsning mot billing
// (domain.md #27: beloppet sätts alltid av servern, aldrig av klienten —
// och "klienten" här är webbläsaren längst ut i kedjan, inte billing/
// payments sinsemellan).

import { Conflict, NotFound, getServiceToken } from "@faktura/shared";
import type Redis from "ioredis";
import { config } from "../config";

export interface StripeCheckoutSessionResult {
  url: string;
}

export async function createStripeCheckoutSession(
  redis: Redis,
  tenantId: number,
  invoiceId: number,
  correlationId: string,
): Promise<StripeCheckoutSessionResult> {
  const token = await getServiceToken({
    authBaseUrl: config.authBaseUrl,
    clientId: config.billingClientId,
    clientSecret: config.billingClientSecret,
    redis,
    scopes: config.billingClientScopes,
  });
  const res = await fetch(`${config.paymentsBaseUrl}/internal/payments/stripe-checkout-sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-tenant-id": String(tenantId),
      "x-correlation-id": correlationId,
    },
    body: JSON.stringify({ invoiceId }),
  });
  if (res.status === 404) throw new NotFound("Fakturan finns inte");
  if (res.status === 409) {
    const body = (await res.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Conflict(body?.message ?? "Fakturan kan inte betalas i sitt nuvarande läge");
  }
  if (!res.ok) {
    throw new Error(`payments /internal/payments/stripe-checkout-sessions svarade ${res.status}`);
  }
  return (await res.json()) as StripeCheckoutSessionResult;
}

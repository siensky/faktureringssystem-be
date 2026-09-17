// S2S-läsning mot documents: GET /portal/invoices/:id/pdf behöver en
// tidsbegränsad, signerad S3-URL. billing genererar aldrig själv en sådan
// URL — documents äger S3-lagringen (architecture.md #2) och exponerar
// redan GET /internal/documents/:invoiceId/url för precis det här ändamålet
// (services/documents/src/documents/documents_api.py — kommentaren där
// pekar redan på "fas 9-portalen"). Samma getServiceToken/mönster som
// alerts/service.ts:s anrop till payments.

import { getServiceToken } from "@faktura/shared";
import type Redis from "ioredis";
import { config } from "../config";

export interface PdfUrlResult {
  url: string;
  expiresAt: number;
}

export async function findPdfUrl(
  redis: Redis,
  invoiceId: number,
  tenantId: number,
  correlationId: string,
): Promise<PdfUrlResult | undefined> {
  const token = await getServiceToken({
    authBaseUrl: config.authBaseUrl,
    clientId: config.billingClientId,
    clientSecret: config.billingClientSecret,
    redis,
    scopes: config.billingClientScopes,
  });
  const res = await fetch(`${config.documentsBaseUrl}/internal/documents/${invoiceId}/url`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-tenant-id": String(tenantId),
      "x-correlation-id": correlationId,
    },
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`documents /internal/documents/:id/url svarade ${res.status}`);
  const body = (await res.json()) as { url: string; expiresAt: number };
  return { url: body.url, expiresAt: body.expiresAt };
}

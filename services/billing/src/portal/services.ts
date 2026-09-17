// ALL affärslogik för kundportalen (code-style.md #2). Läsning bara —
// portalen skriver aldrig en faktura. NotFound (aldrig Forbidden) på allt
// som inte tillhör den inloggade kunden — code-style.md #14, samma regel
// som tenant-gränsen: att svara "förbjudet" skulle bekräfta att fakturan
// finns hos någon annan.

import { NotFound } from "@faktura/shared";
import type { RequestContext } from "@faktura/shared";
import type Redis from "ioredis";
import type { Sql } from "postgres";
import { findPdfUrl } from "./documents-client";
import { toAccountSummary, toDetail, toSummary } from "./mappers";
import { PortalRepository } from "./repository";

export function createPortalService(sql: Sql, redis: Redis) {
  return {
    async list(ctx: RequestContext, query: { limit?: number; offset?: number }) {
      const repo = new PortalRepository(sql, ctx);
      const limit = Math.min(query.limit ?? 50, 200);
      const offset = query.offset ?? 0;
      const rows = await repo.list({ limit, offset });
      return rows.map(toSummary);
    },

    async get(ctx: RequestContext, id: number) {
      const repo = new PortalRepository(sql, ctx);
      const row = await repo.findById(id);
      if (!row) throw new NotFound("Fakturan finns inte");
      const [items, paidOre] = await Promise.all([repo.findItems(id), repo.paidOre(id)]);
      return toDetail(row, items, paidOre);
    },

    async getPdfUrl(ctx: RequestContext, id: number) {
      const repo = new PortalRepository(sql, ctx);
      const row = await repo.findById(id);
      if (!row) throw new NotFound("Fakturan finns inte");
      const result = await findPdfUrl(redis, id, ctx.tenantId, ctx.correlationId);
      if (!result) throw new NotFound("Ingen PDF för fakturan än");
      return { url: result.url, expiresAt: new Date(result.expiresAt * 1000).toISOString() };
    },

    async accountSummary(ctx: RequestContext) {
      const repo = new PortalRepository(sql, ctx);
      return toAccountSummary(await repo.accountSummary());
    },
  };
}

export type PortalService = ReturnType<typeof createPortalService>;

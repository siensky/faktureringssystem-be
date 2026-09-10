// Affärslogik för company-settings. Lat skapande, partiell uppdatering,
// och en S2S-läsning för documents/payments.

import { NotFound, type RequestContext } from "@faktura/shared";
import type { Sql } from "postgres";
import { toAdminView, toInternalView } from "./mappers";
import { CompanySettingsRepository } from "./repository";
import type { CompanySettingsPatch } from "./types";

export function createCompanySettingsService(sql: Sql) {
  const repo = (ctx: RequestContext) => new CompanySettingsRepository(sql, ctx);

  return {
    async getForAdmin(ctx: RequestContext) {
      return toAdminView(await repo(ctx).lazyGet());
    },

    async update(ctx: RequestContext, patch: CompanySettingsPatch) {
      const columns: Record<string, string | number | null> = {};
      if (patch.companyName !== undefined) columns.company_name = patch.companyName;
      if (patch.orgNumber !== undefined) columns.org_number = patch.orgNumber;
      if (patch.bankgiro !== undefined) columns.bankgiro = patch.bankgiro;
      if (patch.vatNumber !== undefined) columns.vat_number = patch.vatNumber;
      if (patch.addressStreet !== undefined) columns.address_street = patch.addressStreet;
      if (patch.addressZip !== undefined) columns.address_zip = patch.addressZip;
      if (patch.addressCity !== undefined) columns.address_city = patch.addressCity;
      if (patch.logoUrl !== undefined) columns.logo_url = patch.logoUrl;
      if (patch.reminderFee !== undefined) {
        columns.reminder_fee_ore = Math.round(patch.reminderFee * 100);
      }
      if (patch.paymentTermsDays !== undefined) {
        columns.payment_terms_days = patch.paymentTermsDays;
      }

      const r = repo(ctx);
      await r.lazyGet(); // se till att raden finns innan UPDATE
      if (Object.keys(columns).length === 0) {
        return toAdminView(await r.lazyGet());
      }
      return toAdminView(await r.update(columns));
    },

    /** S2S: full vy för snapshot/PDF. 404 om tenanten aldrig rört billing. */
    async getForService(ctx: RequestContext) {
      const row = await repo(ctx).find();
      if (!row) throw new NotFound("Inga företagsuppgifter för den här tenanten");
      return toInternalView(row);
    },
  };
}

export type CompanySettingsService = ReturnType<typeof createCompanySettingsService>;

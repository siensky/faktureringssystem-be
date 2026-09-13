// Affärslogik för company-settings. Lat skapande vid skrivning (aldrig vid
// läsning), partiell uppdatering med format­validering, och en S2S-läsning
// för documents/payments.

import {
  BadRequest,
  Conflict,
  NotFound,
  type RequestContext,
  isValidBankgiro,
  isValidOrgNumber,
  normalizeBankgiro,
} from "@faktura/shared";
import type { Sql } from "postgres";
import { writeAuditLog } from "../audit";
import { defaultAdminView, toAdminView, toInternalView } from "./mappers";
import { CompanySettingsRepository, findTenantIdByBankgiro } from "./repository";
import type { CompanySettingsPatch } from "./types";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export function createCompanySettingsService(sql: Sql) {
  const repo = (ctx: RequestContext) => new CompanySettingsRepository(sql, ctx);

  return {
    /** GET har inga sidoeffekter: finns ingen rad, svara med defaultvärden. */
    async getForAdmin(ctx: RequestContext) {
      const row = await repo(ctx).find();
      return row ? toAdminView(row) : defaultAdminView();
    },

    async update(ctx: RequestContext, patch: CompanySettingsPatch) {
      if (patch.bankgiro !== undefined && !isValidBankgiro(patch.bankgiro)) {
        throw new BadRequest("Ogiltigt bankgironummer");
      }
      if (patch.orgNumber !== undefined && !isValidOrgNumber(patch.orgNumber)) {
        throw new BadRequest("Ogiltigt organisationsnummer");
      }

      const columns: Record<string, string | number | null> = {};
      if (patch.companyName !== undefined) columns.company_name = patch.companyName;
      if (patch.orgNumber !== undefined) columns.org_number = patch.orgNumber;
      if (patch.bankgiro !== undefined) columns.bankgiro = normalizeBankgiro(patch.bankgiro);
      if (patch.vatNumber !== undefined) columns.vat_number = patch.vatNumber;
      if (patch.addressStreet !== undefined) columns.address_street = patch.addressStreet;
      if (patch.addressZip !== undefined) columns.address_zip = patch.addressZip;
      if (patch.addressCity !== undefined) columns.address_city = patch.addressCity;
      if (patch.logoUrl !== undefined) columns.logo_url = patch.logoUrl;
      if (patch.reminderFeeOre !== undefined) columns.reminder_fee_ore = patch.reminderFeeOre;
      if (patch.paymentTermsDays !== undefined) {
        columns.payment_terms_days = patch.paymentTermsDays;
      }

      try {
        return await sql.begin(async (tx) => {
          const r = new CompanySettingsRepository(sql, ctx);
          await r.lazyGet(tx);
          const row =
            Object.keys(columns).length === 0 ? await r.lazyGet(tx) : await r.update(columns, tx);

          // bankgiro styr vart alla framtida betalningar går — den mest
          // värdefulla mutationen i tjänsten, får inte sakna spår.
          await writeAuditLog(tx, {
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            action: "company_settings.updated",
            resourceType: "company_settings",
            resourceId: String(ctx.tenantId),
            correlationId: ctx.correlationId,
            metadata: { fields: Object.keys(columns) },
          });
          return toAdminView(row);
        });
      } catch (error) {
        // company_settings_bankgiro_key: en annan tenant äger redan det
        // bankgirot. 409, inte 500 — och meddelandet nämner ALDRIG vilken
        // tenant (code-style.md #14, samma informationsläcka över
        // tenant-gränsen som PR-granskning fas 5, punkt 9, flaggade).
        if (isUniqueViolation(error)) {
          throw new Conflict("Bankgirot används redan av en annan tenant");
        }
        throw error;
      }
    },

    /** S2S: full vy för snapshot/PDF. 404 om tenanten aldrig rört billing. */
    async getForService(ctx: RequestContext) {
      const row = await repo(ctx).find();
      if (!row) throw new NotFound("Inga företagsuppgifter för den här tenanten");
      return toInternalView(row);
    },

    /**
     * S2S: bankgiro -> tenant, till payments matchningsmotor (fas 5-planen
     * avsnitt 2). Ingen RequestContext här — det ÄR det här anropets jobb
     * att avgöra tenanten, inte att förutsätta en.
     */
    async resolveTenantByBankgiro(bankgiro: string) {
      const tenantId = await findTenantIdByBankgiro(sql, normalizeBankgiro(bankgiro));
      if (tenantId === undefined) throw new NotFound("Inget bankgiro matchar en tenant");
      return { tenantId };
    },
  };
}

export type CompanySettingsService = ReturnType<typeof createCompanySettingsService>;

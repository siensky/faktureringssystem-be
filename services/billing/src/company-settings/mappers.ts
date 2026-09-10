// Databasrad -> API-form. Belopp öre -> kronor sista steget (database.md #8).
// De interna räknarna (next_invoice_number) lämnar aldrig admin-API:t.

import { COMPANY_SETTINGS_DEFAULTS, type CompanySettingsRow } from "./types";

function readiness(row: CompanySettingsRow): boolean {
  return row.company_name !== null && row.org_number !== null && row.bankgiro !== null;
}

export function toAdminView(row: CompanySettingsRow) {
  return {
    companyName: row.company_name,
    orgNumber: row.org_number,
    bankgiro: row.bankgiro,
    vatNumber: row.vat_number,
    address: {
      street: row.address_street,
      zip: row.address_zip,
      city: row.address_city,
    },
    logoUrl: row.logo_url,
    reminderFee: Number(row.reminder_fee_ore) / 100,
    paymentTermsDays: row.payment_terms_days,
    // Fakturan kan inte skickas förrän avsändaruppgifterna finns.
    isReadyToSend: readiness(row),
  };
}

/** Vy när raden inte skapats än — GET ska inte ha sidoeffekter. */
export function defaultAdminView() {
  return {
    companyName: null,
    orgNumber: null,
    bankgiro: null,
    vatNumber: null,
    address: { street: null, zip: null, city: null },
    logoUrl: null,
    reminderFee: COMPANY_SETTINGS_DEFAULTS.reminderFeeOre / 100,
    paymentTermsDays: COMPANY_SETTINGS_DEFAULTS.paymentTermsDays,
    isReadyToSend: false,
  };
}

/** S2S-vy för documents/payments: öre kvar som öre, adress och avgift råa. */
export function toInternalView(row: CompanySettingsRow) {
  return {
    tenantId: row.tenant_id,
    companyName: row.company_name,
    orgNumber: row.org_number,
    bankgiro: row.bankgiro,
    vatNumber: row.vat_number,
    address: {
      street: row.address_street,
      zip: row.address_zip,
      city: row.address_city,
    },
    logoUrl: row.logo_url,
    reminderFeeOre: Number(row.reminder_fee_ore),
    paymentTermsDays: row.payment_terms_days,
  };
}

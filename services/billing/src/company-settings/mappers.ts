// Databasrad -> API-form. Belopp öre -> kronor sista steget (database.md #8).
// De interna räknarna (next_invoice_number) lämnar aldrig admin-API:t.

import type { CompanySettingsRow } from "./types";

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
    isReadyToSend: row.company_name !== null && row.org_number !== null && row.bankgiro !== null,
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

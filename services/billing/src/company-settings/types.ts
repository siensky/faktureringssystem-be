export interface CompanySettingsRow {
  tenant_id: number;
  company_name: string | null;
  org_number: string | null;
  bankgiro: string | null;
  vat_number: string | null;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  logo_url: string | null;
  // INTEGER-kolumn -> postgres.js ger ett tal.
  next_invoice_number: number;
  // BIGINT -> postgres.js ger en sträng.
  reminder_fee_ore: string;
  payment_terms_days: number;
  tenant_status: "active" | "suspended";
  created_at: Date;
  updated_at: Date;
}

export interface CompanySettingsPatch {
  companyName?: string;
  orgNumber?: string;
  bankgiro?: string;
  vatNumber?: string;
  addressStreet?: string;
  addressZip?: string;
  addressCity?: string;
  logoUrl?: string;
  /** Heltal öre — belopp kommer in i öre vid API-gränsen (database.md #6). */
  reminderFeeOre?: number;
  paymentTermsDays?: number;
}

// Måste spegla DEFAULT-värdena i migrations/0004_billing.js — används av
// GET innan raden skapats så en läsning slipper ha en sidoeffekt.
export const COMPANY_SETTINGS_DEFAULTS = {
  reminderFeeOre: 6000,
  paymentTermsDays: 30,
} as const;

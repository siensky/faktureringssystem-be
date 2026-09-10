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
  next_invoice_number: string;
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
  /** Kronor i API:t, öre i databasen. */
  reminderFee?: number;
  paymentTermsDays?: number;
}

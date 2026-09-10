export type CustomerType = "company" | "private";

export interface CustomerRow {
  id: number;
  tenant_id: number;
  customer_type: CustomerType;
  name: string;
  email: string;
  email_valid: boolean;
  org_number: string | null;
  pnr_encrypted: string | null;
  pnr_hmac: string | null;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  payment_terms_days: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCustomerInput {
  customerType: CustomerType;
  name: string;
  email: string;
  orgNumber?: string;
  /** Bara privatkund. Krypteras + HMAC:as, lagras aldrig i klartext. */
  pnr?: string;
  addressStreet?: string;
  addressZip?: string;
  addressCity?: string;
  paymentTermsDays?: number;
}

export interface UpdateCustomerInput {
  name?: string;
  email?: string;
  orgNumber?: string;
  addressStreet?: string;
  addressZip?: string;
  addressCity?: string;
  paymentTermsDays?: number | null;
}

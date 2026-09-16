// REST-form av kund-endpoints i billing (services/billing/src/customers).
// Delas med apps/backoffice.

export type CustomerType = "company" | "private";

export interface CustomerDto {
  id: number;
  customerType: CustomerType;
  name: string;
  email: string;
  isEmailValid: boolean;
  orgNumber: string | null;
  hasPnr: boolean;
  address: {
    street: string | null;
    zip: string | null;
    city: string | null;
  };
  paymentTermsDays: number | null;
  createdAt: string;
}

export interface CreateCustomerInput {
  customerType: CustomerType;
  name: string;
  email: string;
  orgNumber?: string;
  /** Bara privatkund. Krypteras + HMAC:as i billing, lagras aldrig i klartext. */
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

// JSON Schema för kund-endpoints. Formen kollas här; samspelet (company ->
// orgNumber, private -> pnr) och mod-10 på org/pnr kollas i servicen mot
// @faktura/shared för ett tydligt felmeddelande.

const email = { type: "string", format: "email", maxLength: 320 } as const;
const name = { type: "string", minLength: 1, maxLength: 200 } as const;
// 10 eller 12 siffror, valfri -/+ -separator och blanksteg. normalizePnr
// kanoniserar; isValidPnr kontrollsiffre- och datumvaliderar.
const pnr = { type: "string", minLength: 10, maxLength: 15 } as const;
const orgNumber = { type: "string", minLength: 10, maxLength: 13 } as const;
const addr = { type: "string", minLength: 1, maxLength: 200 } as const;
const zip = { type: "string", minLength: 1, maxLength: 12 } as const;
const paymentTermsDays = { type: "integer", minimum: 0, maximum: 365 } as const;

// Delas med invoices/schema.ts (kunduppgifter inline på fakturaformuläret,
// se createInvoiceBody) — samma valideringsregler ska gälla oavsett väg in.
export const customerProperties = {
  customerType: { type: "string", enum: ["company", "private"] },
  name,
  email,
  orgNumber,
  pnr,
  addressStreet: addr,
  addressZip: zip,
  addressCity: addr,
  paymentTermsDays,
} as const;
export const customerRequired = ["customerType", "name", "email"] as const;

export const createCustomerBody = {
  type: "object",
  additionalProperties: false,
  required: customerRequired,
  properties: customerProperties,
} as const;

export const updateCustomerBody = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name,
    email,
    orgNumber,
    addressStreet: addr,
    addressZip: zip,
    addressCity: addr,
    paymentTermsDays: { anyOf: [paymentTermsDays, { type: "null" }] },
  },
} as const;

export const customerIdParams = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "integer", minimum: 1 } },
} as const;

export const listQuery = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
  },
} as const;

// Fas 12: hex-sträng, HMAC-SHA256 (samma format som customers.pnr_hmac).
// Grov formkontroll — ett värde som inte matchar någon kund ger bara en
// tom träfflista, aldrig 404 (ingen tenant är känd att svara "hos den" om).
export const byPnrHmacQuery = {
  type: "object",
  additionalProperties: false,
  required: ["pnrHmac"],
  properties: { pnrHmac: { type: "string", pattern: "^[0-9a-f]{64}$" } },
} as const;

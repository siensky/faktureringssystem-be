// JSON Schema för kund-endpoints. type-beroende krav (company -> orgNumber,
// private -> pnr) kan JSON Schema uttrycka, men felmeddelandet blir
// tydligare i servicen — schemat kollar formen, servicen kollar samspelet.

const email = { type: "string", format: "email", maxLength: 320 } as const;
const name = { type: "string", minLength: 1, maxLength: 200 } as const;
const pnr = { type: "string", pattern: "^[0-9]{10,12}$" } as const;
const orgNumber = { type: "string", minLength: 6, maxLength: 20 } as const;
const addr = { type: "string", minLength: 1, maxLength: 200 } as const;
const zip = { type: "string", minLength: 1, maxLength: 12 } as const;
const paymentTermsDays = { type: "integer", minimum: 0, maximum: 365 } as const;

export const createCustomerBody = {
  type: "object",
  additionalProperties: false,
  required: ["customerType", "name", "email"],
  properties: {
    customerType: { type: "string", enum: ["company", "private"] },
    name,
    email,
    orgNumber,
    pnr,
    addressStreet: addr,
    addressZip: zip,
    addressCity: addr,
    paymentTermsDays,
  },
} as const;

export const updateCustomerBody = {
  type: "object",
  additionalProperties: false,
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

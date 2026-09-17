// JSON Schema för faktura-endpoints (code-style.md #18). Belopp in i öre,
// aldrig kronor-float. Gränserna på quantity och unitPriceOre är valda så
// att radbeloppsberäkningen (quantity * unitPriceOre) håller sig inom
// säkert heltalsintervall även vid 200 rader.

import { customerProperties, customerRequired } from "../customers/schema";

// Admin kan antingen peka på en befintlig kund (customerId) eller fylla i
// en ny direkt i fakturaformuläret (customer) — inte båda, inte ingetdera.
// Samma fältvalidering som POST /admin/customers (customerProperties),
// så en ny kund skapad via fakturan aldrig är mindre validerad än en
// skapad via kundsidan.
const inlineCustomer = {
  type: "object",
  additionalProperties: false,
  required: customerRequired,
  properties: customerProperties,
} as const;

const isoDate = { type: "string", format: "date" } as const;
const line = {
  type: "object",
  additionalProperties: false,
  required: ["description", "quantity", "unitPriceOre", "vatRate"],
  properties: {
    description: { type: "string", minLength: 1, maxLength: 500 },
    quantity: { type: "number", exclusiveMinimum: 0, maximum: 100_000 },
    unitPriceOre: { type: "integer", minimum: 0, maximum: 100_000_000 },
    vatRate: { type: "number", enum: [0, 6, 12, 25] },
    unit: { type: "string", minLength: 1, maxLength: 20 },
  },
} as const;

const lines = { type: "array", minItems: 1, maxItems: 200, items: line } as const;
const currency = { type: "string", enum: ["SEK"] } as const;

export const createInvoiceBody = {
  type: "object",
  additionalProperties: false,
  required: ["lines"],
  properties: {
    customerId: { type: "integer", minimum: 1 },
    customer: inlineCustomer,
    dateIssued: isoDate,
    dateDue: isoDate,
    currency,
    lines,
  },
  oneOf: [{ required: ["customerId"] }, { required: ["customer"] }],
} as const;

export const updateInvoiceBody = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    dateIssued: isoDate,
    dateDue: isoDate,
    currency,
    lines,
  },
} as const;

export const invoiceIdParams = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "integer", minimum: 1 } },
} as const;

export const listInvoicesQuery = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["draft", "sent", "paid", "overdue", "credited", "superseded", "settled"],
    },
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
  },
} as const;

export const listDeliveriesQuery = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["none", "queued", "sent", "delivered", "bounced", "failed"],
    },
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
  },
} as const;

export const byOcrQuery = {
  type: "object",
  additionalProperties: false,
  required: ["ocr"],
  properties: { ocr: { type: "string", pattern: "^[0-9]{3,30}$" } },
} as const;

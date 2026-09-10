// JSON Schema för faktura-endpoints (code-style.md #18).

const isoDate = { type: "string", format: "date" } as const;
const line = {
  type: "object",
  additionalProperties: false,
  required: ["description", "quantity", "unitPrice", "vatRate"],
  properties: {
    description: { type: "string", minLength: 1, maxLength: 500 },
    quantity: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 },
    unitPrice: { type: "number", minimum: 0, maximum: 100_000_000 },
    vatRate: { type: "number", enum: [0, 6, 12, 25] },
    unit: { type: "string", minLength: 1, maxLength: 20 },
  },
} as const;

const lines = { type: "array", minItems: 1, maxItems: 200, items: line } as const;
const currency = { type: "string", enum: ["SEK"] } as const;

export const createInvoiceBody = {
  type: "object",
  additionalProperties: false,
  required: ["customerId", "lines"],
  properties: {
    customerId: { type: "integer", minimum: 1 },
    dateIssued: isoDate,
    dateDue: isoDate,
    currency,
    lines,
  },
} as const;

export const updateInvoiceBody = {
  type: "object",
  additionalProperties: false,
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
  },
} as const;

export const byOcrQuery = {
  type: "object",
  additionalProperties: false,
  required: ["ocr"],
  properties: { ocr: { type: "string", pattern: "^[0-9]{3,30}$" } },
} as const;

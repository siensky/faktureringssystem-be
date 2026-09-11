// JSON Schema för den manuella matchningskön (code-style.md #18).

export const transactionIdParams = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "integer", minimum: 1 } },
} as const;

export const matchBody = {
  type: "object",
  additionalProperties: false,
  required: ["invoiceId"],
  properties: { invoiceId: { type: "integer", minimum: 1 } },
} as const;

export const ignoreBody = {
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: { reason: { type: "string", minLength: 1, maxLength: 500 } },
} as const;

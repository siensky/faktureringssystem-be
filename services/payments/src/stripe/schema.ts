export const createCheckoutSessionBody = {
  type: "object",
  additionalProperties: false,
  required: ["invoiceId"],
  properties: {
    invoiceId: { type: "integer", minimum: 1 },
  },
} as const;

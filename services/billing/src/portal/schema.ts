// Rena JSON Schema för inkommande data (code-style.md #18).

export const listInvoicesQuery = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
  },
} as const;

export const invoiceIdParams = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "integer", minimum: 1 } },
} as const;

// Fas 12: S2S-variant av GET /portal/account-summary — customerId kommer
// in explicit i stället för via en kundinloggnings JWT-claim, eftersom
// anroparen (auth) redan har slagit upp kunden via user_company_links.
export const accountSummaryInternalQuery = {
  type: "object",
  additionalProperties: false,
  required: ["customerId"],
  properties: { customerId: { type: "integer", minimum: 1 } },
} as const;

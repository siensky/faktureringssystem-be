export const initBody = {
  type: "object",
  additionalProperties: false,
  required: ["personalNumber"],
  properties: {
    // Svenskt personnummer, 12 siffror (ÅÅÅÅMMDDNNNN) eller mock-värdena.
    personalNumber: { type: "string", minLength: 6, maxLength: 13 },
  },
} as const;

export const collectBody = {
  type: "object",
  additionalProperties: false,
  required: ["orderRef"],
  properties: { orderRef: { type: "string", minLength: 8, maxLength: 100 } },
} as const;

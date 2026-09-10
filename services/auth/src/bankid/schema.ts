// Personnummer: 10–13 siffror (ÅÅ)ÅÅMMDDNNNN, valfritt bindestreck utelämnat.
// Mock-provider-sentinelerna (se provider.ts) är valida siffersträngar och
// läcker inte in i det publika kontraktet.
export const initBody = {
  type: "object",
  additionalProperties: false,
  required: ["personalNumber"],
  properties: {
    personalNumber: { type: "string", pattern: "^[0-9]{10,13}$" },
  },
} as const;

export const collectBody = {
  type: "object",
  additionalProperties: false,
  required: ["orderRef"],
  properties: { orderRef: { type: "string", minLength: 8, maxLength: 100 } },
} as const;

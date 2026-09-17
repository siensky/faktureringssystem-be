// Personnummer: 10–13 siffror (ÅÅ)ÅÅMMDDNNNN, valfritt bindestreck utelämnat.
// Mock-provider-sentinelerna (se provider.ts) är valida siffersträngar och
// läcker inte in i det publika kontraktet.
//
// Valfritt, inte obligatoriskt: BankIDs riktiga /auth-endpoint (v6.0, den
// version som faktiskt fungerar mot RP-testmiljön — se config.ts) tar
// inte alls emot personalNumber som fält ("Invalid key in request body"
// om det skickas ändå för QR-flödet). Utan personnummer blir det BankIDs
// QR-flöde ("annan enhet") — precis det BankIdProvider.init() redan
// stödjer, bara HTTP-schemat var för strikt.
export const initBody = {
  type: "object",
  additionalProperties: false,
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

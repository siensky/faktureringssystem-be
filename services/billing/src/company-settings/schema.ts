// JSON Schema för PUT /admin/company-settings. Alla fält valfria men minst
// ett krävs (minProperties) — en tom PUT ska inte skriva en auditrad för
// ingenting. additionalProperties: false så en felstavad nyckel blir 400.
// Format/mod-10 på bankgiro och orgNumber kollas i servicen mot
// @faktura/shared — schemat kollar bara grov form.

const optionalString = { type: "string", minLength: 1, maxLength: 200 } as const;

export const updateCompanySettingsBody = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    companyName: optionalString,
    orgNumber: { type: "string", minLength: 10, maxLength: 13 },
    bankgiro: { type: "string", minLength: 7, maxLength: 11 },
    vatNumber: { type: "string", minLength: 1, maxLength: 20 },
    addressStreet: optionalString,
    addressZip: { type: "string", minLength: 1, maxLength: 12 },
    addressCity: optionalString,
    // Server-side-renderaren (WeasyPrint, fas 4) hämtar den här URL:en.
    // file:// och interna IP:n vore SSRF/lokal filläsning — lås till https.
    logoUrl: {
      type: "string",
      pattern: "^https://[^\\s]+$",
      maxLength: 500,
    },
    reminderFeeOre: { type: "integer", minimum: 0, maximum: 100_000_00 },
    paymentTermsDays: { type: "integer", minimum: 0, maximum: 365 },
  },
} as const;

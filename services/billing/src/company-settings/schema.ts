// JSON Schema för PUT /admin/company-settings. Alla fält valfria —
// partiell uppdatering. additionalProperties: false så en felstavad nyckel
// blir ett 400, inte tyst ignorerad.

const optionalString = { type: "string", minLength: 1, maxLength: 200 } as const;

export const updateCompanySettingsBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    companyName: optionalString,
    orgNumber: { type: "string", minLength: 6, maxLength: 20 },
    bankgiro: { type: "string", minLength: 1, maxLength: 20 },
    vatNumber: { type: "string", minLength: 1, maxLength: 20 },
    addressStreet: optionalString,
    addressZip: { type: "string", minLength: 1, maxLength: 12 },
    addressCity: optionalString,
    logoUrl: { type: "string", minLength: 1, maxLength: 500 },
    reminderFee: { type: "number", minimum: 0, maximum: 100000 },
    paymentTermsDays: { type: "integer", minimum: 0, maximum: 365 },
  },
} as const;

export const tokenBody = {
  type: "object",
  additionalProperties: false,
  required: ["grant_type", "client_id", "client_secret"],
  properties: {
    grant_type: { type: "string", enum: ["client_credentials"] },
    client_id: { type: "string", minLength: 1, maxLength: 200 },
    client_secret: { type: "string", minLength: 1, maxLength: 500 },
    scope: { type: "string", maxLength: 2000 },
  },
} as const;

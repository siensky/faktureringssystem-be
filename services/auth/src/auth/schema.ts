// Rena JSON Schema för inkommande data (code-style.md #18, planens
// Validering-beslut). Fastify validerar mot dessa på varje route.

const email = { type: "string", format: "email", maxLength: 320 } as const;
const password = { type: "string", minLength: 12, maxLength: 200 } as const;
const token = { type: "string", minLength: 20, maxLength: 500 } as const;

export const registerBody = {
  type: "object",
  additionalProperties: false,
  required: ["companyName", "orgNumber", "email", "password"],
  properties: {
    companyName: { type: "string", minLength: 1, maxLength: 200 },
    orgNumber: { type: "string", minLength: 6, maxLength: 20 },
    email,
    password,
  },
} as const;

export const loginBody = {
  type: "object",
  additionalProperties: false,
  required: ["email", "password"],
  properties: { email, password: { type: "string", minLength: 1, maxLength: 200 } },
} as const;

export const refreshBody = {
  type: "object",
  additionalProperties: false,
  required: ["refreshToken"],
  properties: { refreshToken: token },
} as const;

export const logoutBody = refreshBody;

export const verifyEmailBody = {
  type: "object",
  additionalProperties: false,
  required: ["token"],
  properties: { token },
} as const;

export const forgotPasswordBody = {
  type: "object",
  additionalProperties: false,
  required: ["email"],
  properties: { email },
} as const;

export const resetPasswordBody = {
  type: "object",
  additionalProperties: false,
  required: ["token", "newPassword"],
  properties: { token, newPassword: password },
} as const;

export const devTokenQuery = {
  type: "object",
  additionalProperties: false,
  required: ["email", "type"],
  properties: {
    email,
    type: { type: "string", enum: ["email_verification", "password_reset", "customer_invite"] },
  },
} as const;

export const createCustomerInviteBody = {
  type: "object",
  additionalProperties: false,
  required: ["customerId", "email"],
  properties: {
    customerId: { type: "integer", minimum: 1 },
    email,
  },
} as const;

export const acceptCustomerInviteBody = {
  type: "object",
  additionalProperties: false,
  required: ["token", "password"],
  properties: { token, password },
} as const;

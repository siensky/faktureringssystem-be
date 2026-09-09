import addFormats from "ajv-formats";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import type { EventEnvelope } from "./generated/envelope";
import { loadSchema } from "./schema-loader";

// Schemafilerna deklarerar $schema: draft/2020-12, så vi använder Ajvs
// 2020-varianten i stället för standard-Ajv (som bara känner draft-07) —
// annars kastar compile() på det okända $schema-värdet.
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const envelopeSchema = loadSchema("schemas/envelope.schema.json");
const validateEnvelopeFn: ValidateFunction = ajv.compile(envelopeSchema);

export class EnvelopeValidationError extends Error {
  constructor(public readonly errors: string) {
    super(`Ogiltig event-envelope: ${errors}`);
    this.name = "EnvelopeValidationError";
  }
}

/**
 * Validerar en godtycklig payload mot envelope-schemat. Kastar
 * EnvelopeValidationError om den inte matchar — architecture.md #4:
 * saknas tenantId går eventet till dead-letter, det gissas aldrig, och det
 * gäller redan här vid gränsen innan något annat rör datan.
 */
export function assertValidEnvelope(data: unknown): asserts data is EventEnvelope {
  if (!validateEnvelopeFn(data)) {
    throw new EnvelopeValidationError(
      ajv.errorsText(validateEnvelopeFn.errors, { separator: "; " }),
    );
  }
}

export function isValidEnvelope(data: unknown): data is EventEnvelope {
  return validateEnvelopeFn(data) === true;
}

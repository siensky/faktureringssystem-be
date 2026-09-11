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

// ── Payload per eventtyp ────────────────────────────────────────────────
// Envelopen säger att `payload` är ett objekt, inget mer. Den faktiska
// formen bor i ett schema per eventtyp, och konsumenten validerar mot det
// innan den rör innehållet. Filnamnet härleds ur eventtypen i stället för
// att stå i en registerfil som kan glömmas bort:
//   invoice.sent              -> schemas/events/invoice-sent.schema.json
//   invoice.delivery_updated  -> schemas/events/invoice-delivery-updated.schema.json

export class PayloadValidationError extends Error {
  constructor(
    public readonly eventType: string,
    public readonly errors: string,
  ) {
    super(`Ogiltig payload för ${eventType}: ${errors}`);
    this.name = "PayloadValidationError";
  }
}

const payloadValidators = new Map<string, ValidateFunction>();

export function payloadSchemaPath(eventType: string): string {
  return `schemas/events/${eventType.replace(/[._]/g, "-")}.schema.json`;
}

function payloadValidator(eventType: string): ValidateFunction {
  const cached = payloadValidators.get(eventType);
  if (cached) return cached;
  const path = payloadSchemaPath(eventType);
  let schema: Record<string, unknown>;
  try {
    schema = loadSchema(path);
  } catch {
    // Ett eventtyp utan schema är ett fel i koden, inte i datan: antingen
    // är typen felstavad eller så glömdes schemat. Att tyst släppa igenom
    // en ovaliderad payload vore värre.
    throw new PayloadValidationError(eventType, `inget schema på ${path}`);
  }
  const fn = ajv.compile(schema);
  payloadValidators.set(eventType, fn);
  return fn;
}

/** Kastar PayloadValidationError om payloaden inte matchar sin eventtyp. */
export function assertValidPayload(eventType: string, payload: unknown): void {
  const validate = payloadValidator(eventType);
  if (!validate(payload)) {
    throw new PayloadValidationError(
      eventType,
      ajv.errorsText(validate.errors, { separator: "; " }),
    );
  }
}

/**
 * Som assertValidPayload, men returnerar false för OGILTIG DATA i stället
 * för att kasta. Ett SAKNAT schema (fel i koden, inte i datan — se
 * payloadValidator ovan) kastar ÄNDÅ PayloadValidationError, i stället för
 * att tyst bli samma "false" som en payload som bara råkar vara felformad
 * — de två fallen ska inte gå att förväxla (PR-granskning fas 4,
 * punkt 24).
 */
export function isValidPayload(eventType: string, payload: unknown): boolean {
  const validate = payloadValidator(eventType); // kastar PayloadValidationError om schemat saknas
  return validate(payload) === true;
}

export * from "./errors";
export { registerErrorHandler } from "./errors/handler";
export { createLogger } from "./logger";
export type { Logger } from "pino";
export type { JsonValue, JsonObject } from "./json";
export { loadEnv, loadEnvWithDefaults, parseIntEnv, MissingEnvError } from "./config";
export { createDbClient, type DbClientOptions } from "./db";
export {
  connectRabbitMQ,
  publishJson,
  publishConfirmed,
  consumeJson,
  type RabbitConnection,
  type JsonMessageHandler,
} from "./rabbitmq";
export { registerHealthRoutes, type ReadinessCheck } from "./health";
export {
  writeEvent,
  startOutboxPublisher,
  backoffSeconds,
  EVENTS_EXCHANGE,
  type WriteEventInput,
  type OutboxPublisher,
} from "./outbox";
export { startSystemPing, PING_EXCHANGE, type PingState, type PingMessage } from "./ping";
export { createRedisClient } from "./redis";
export {
  startService,
  type StartServiceOptions,
  type ServiceContext,
} from "./service";
export { TenantScopedRepository, type RequestContext } from "./repository";
export {
  signAccessToken,
  verifyAccessToken,
  USER_TOKEN,
  createRequireUser,
  contextOf,
  resolveCorrelationId,
  signServiceToken,
  verifyServiceToken,
  assertScope,
  SERVICE_TOKEN,
  createRequireService,
  serviceContextOf,
  requireTenantHeader,
  getServiceToken,
  type AccessTokenClaims,
  type VerifiedServiceToken,
  type ServiceContext as M2MServiceContext,
  type TenantActiveCheck,
  type ServiceTokenClientOptions,
} from "./auth";
export { deriveOcr, isValidOcr } from "./ocr";
export {
  normalizePnr,
  isValidPnr,
  isValidOrgNumber,
  isValidBankgiro,
  normalizeBankgiro,
  luhn,
} from "./swedish-id";
export {
  encryptField,
  decryptField,
  hmacField,
  timingSafeEqualHex,
  generateKeyHex,
} from "./crypto";

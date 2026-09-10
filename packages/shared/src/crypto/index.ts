// Kryptering av känsliga fält (personnummer m.m.) och deterministisk HMAC
// för uppslag. Se planens "Säkerhet: Personnummer" och domain.md #20.
//
// Två SEPARATA nycklar krävs, aldrig samma:
//   - en krypteringsnyckel (AES-256-GCM) för att kunna visa värdet igen
//   - en HMAC-peppar för deterministiskt uppslag (samma indata -> samma hash,
//     så en WHERE-fråga eller inloggning kan slå upp raden)
// Att återanvända samma nyckel till båda gör HMAC-utdatan förutsägbar från
// krypteringsnyckeln i vissa konstruktioner — separata nycklar är billigt
// och tar bort den risken helt.
//
// Nycklarna kommer alltid från miljön (code-style.md #23) och dokumenteras
// som något som aldrig får ligga i samma backup som databasen.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit nonce, rekommenderat för GCM
const AUTH_TAG_BYTES = 16;

function keyFromHex(hex: string, label: string): Buffer {
  const key = Buffer.from(hex, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${label} måste vara ${KEY_BYTES} byte (${KEY_BYTES * 2} hex-tecken), fick ${key.length} byte`,
    );
  }
  return key;
}

/**
 * Krypterar en sträng med AES-256-GCM. Returnerar base64 av
 * iv ‖ authTag ‖ ciphertext — allt som behövs för att dekryptera ligger i
 * samma sträng, ingen separat kolumn för iv behövs.
 */
export function encryptField(plaintext: string, keyHex: string): string {
  const key = keyFromHex(keyHex, "Krypteringsnyckeln");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Dekrypterar en sträng skapad av encryptField. Kastar om nyckeln är fel
 * eller datan manipulerad — GCM:s autentiseringstagg gör manipulation
 * upptäckbar, inte bara krypterad.
 */
export function decryptField(payload: string, keyHex: string): string {
  const key = keyFromHex(keyHex, "Krypteringsnyckeln");
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error("Krypterad payload är för kort för att vara giltig");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Deterministisk HMAC-SHA256 för uppslag (t.ex. pnr_hmac, pnr_hash).
 * Samma indata och nyckel ger alltid samma utdata, vilket är det som gör
 * en WHERE pnr_hmac = ? -fråga möjlig utan att lagra personnumret i klartext.
 */
export function hmacField(value: string, keyHex: string): string {
  const key = keyFromHex(keyHex, "HMAC-peppar");
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

/**
 * Tidssäker jämförelse av två hex-strängar (t.ex. token mot lagrad hash).
 * En vanlig === läcker information genom hur lång tid jämförelsen tar —
 * code-style.md #21.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) {
    // Även om längderna skiljer sig måste vi göra en jämförelse med
    // konstant tid för att inte läcka längdinformation via tidiga return.
    // randomBytes-buffret har korrekt längd men kan aldrig matcha bufA.
    timingSafeEqual(bufA, randomBytes(bufA.length));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Genererar en ny slumpad 32-byte nyckel som hex, för att sätta upp .env lokalt. */
export function generateKeyHex(): string {
  return randomBytes(KEY_BYTES).toString("hex");
}

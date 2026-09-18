// Speglar services/auth/src/bankid/provider.ts:computeQrCode() exakt —
// samma formel, bara Web Crypto i stället för node:crypto. BankIDs QR-kod
// roterar ungefär varje sekund så länge ordern är öppen; den måste räknas
// om på nytt varje gång den visas, inte cachas.
export async function computeQrCode(
  qrStartToken: string,
  qrStartSecret: string,
  qrStartedAt: Date,
  now: Date = new Date(),
): Promise<string> {
  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - qrStartedAt.getTime()) / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(qrStartSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(elapsedSeconds)),
  );
  const qrAuthCode = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `bankid.${qrStartToken}.${elapsedSeconds}.${qrAuthCode}`;
}

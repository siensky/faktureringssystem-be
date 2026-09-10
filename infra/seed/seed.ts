// Engångs-provisionering av S2S-klienter i `service_clients` (auth äger
// tabellen). Körs som en egen container EFTER migrate och FÖRE tjänsterna
// (docker-compose.yml), precis som rabbitmq-init.
//
// Varför ett eget steg och inte en migration: seed-data hör aldrig hemma i
// en migration (database.md #5). Varför inte bara i e2e-testerna: då kan
// documents inte hämta snapshoten vid ett vanligt `docker compose up`, och
// planens verifieringsrökprov går inte att köra.
//
// Vägrar köra med NODE_ENV=production (code-style.md #24) — ett script som
// skapar kända konton med kända hemligheter är en bakdörr i produktion.
// Där provisioneras klienter genom en riktig, granskad rutin.
//
// Idempotent: ON CONFLICT ... DO UPDATE, säkert att köra om vid varje
// `docker compose up`.

import postgres from "postgres";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`seed: saknar miljövariabel ${name}`);
    process.exit(1);
  }
  return value;
}

async function hashSecret(secret: string): Promise<string> {
  // Samma algoritm som auth verifierar med — Bun.password (argon2id),
  // services/auth/src/passwords.ts.
  return Bun.password.hash(secret, { algorithm: "argon2id" });
}

interface ClientSpec {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  description: string;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error("seed: vägrar köra med NODE_ENV=production");
    process.exit(1);
  }

  const databaseUrl = required("DATABASE_URL");

  const clients: ClientSpec[] = [
    {
      clientId: required("DOCUMENTS_CLIENT_ID"),
      clientSecret: required("DOCUMENTS_CLIENT_SECRET"),
      scopes: (
        process.env.DOCUMENTS_CLIENT_SCOPES ??
        "billing:invoice:read billing:company:read billing:customer:read"
      )
        .split(/\s+/)
        .filter(Boolean),
      description: "documents-tjänsten: läser snapshot/kund/företag för PDF-rendering (fas 4)",
    },
  ];

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    for (const client of clients) {
      const hash = await hashSecret(client.clientSecret);
      await sql`
        INSERT INTO service_clients (client_id, client_secret_hash, allowed_scopes, description)
        VALUES (${client.clientId}, ${hash}, ${client.scopes}, ${client.description})
        ON CONFLICT (client_id) DO UPDATE
        SET client_secret_hash = EXCLUDED.client_secret_hash,
            allowed_scopes = EXCLUDED.allowed_scopes,
            description = EXCLUDED.description
      `;
      console.log(`seed: ✓ ${client.clientId} (${client.scopes.join(" ")})`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  console.log("seed: klart.");
}

main().catch((error) => {
  console.error("seed: misslyckades", error);
  process.exit(1);
});

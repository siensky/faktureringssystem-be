// SQL för M2M-modulen (database.md #22).

import type { Sql } from "postgres";

export interface ServiceClientRow {
  client_id: string;
  client_secret_hash: string;
  allowed_scopes: string[];
}

export function createM2mRepository(sql: Sql) {
  return {
    async findServiceClient(clientId: string): Promise<ServiceClientRow | undefined> {
      const [row] = await sql<ServiceClientRow[]>`
        SELECT client_id, client_secret_hash, allowed_scopes
        FROM service_clients WHERE client_id = ${clientId} LIMIT 1
      `;
      return row;
    },
  };
}

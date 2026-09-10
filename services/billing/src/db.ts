import { createDbClient } from "@faktura/shared";
import { config } from "./config";

// En anslutningspool för hela billing-tjänsten. All SQL går via
// repository-lagret (database.md #22).
export const sql = createDbClient(config.databaseUrl);

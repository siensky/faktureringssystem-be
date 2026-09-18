import type { Sql, TransactionSql } from "postgres";

export interface BankIdCustomerIdentity {
  id: number;
}

export interface CompanyLink {
  tenant_id: number;
  customer_id: number;
  tenant_name: string;
}

export function createBankIdRepository(sql: Sql) {
  return {
    /**
     * Fas 12: en BankID-kundidentitet bär inte tenant_id/customer_id på sin
     * egen rad — de kopplingarna ligger i user_company_links
     * (syncCompanyLinks nedan). ON CONFLICT DO NOTHING + omläsning i stället
     * för SELECT-sen-INSERT: två samtidiga inloggningar för samma person
     * (två flikar, dubbelklick) kan annars båda se "finns inte" och båda
     * försöka skapa raden. users_bankid_customer_pnr_hash_key
     * (migrations/0011) gör indexet-uppslaget deterministiskt: exakt en rad
     * per verkligt personnummer, aldrig en tvetydig LIMIT 1.
     */
    async findOrCreateBankIdCustomerIdentity(
      tx: TransactionSql,
      pnrHash: string,
    ): Promise<BankIdCustomerIdentity> {
      const [inserted] = await tx<BankIdCustomerIdentity[]>`
        INSERT INTO users (role, auth_method, pnr_hash)
        VALUES ('customer', 'bankid', ${pnrHash})
        ON CONFLICT (pnr_hash) WHERE auth_method = 'bankid' AND role = 'customer'
        DO NOTHING
        RETURNING id
      `;
      if (inserted) return inserted;

      const [existing] = await tx<BankIdCustomerIdentity[]>`
        SELECT id FROM users
        WHERE pnr_hash = ${pnrHash} AND auth_method = 'bankid' AND role = 'customer'
        LIMIT 1
      `;
      if (!existing) {
        throw new Error("BankID-kundidentitet försvann direkt efter ON CONFLICT DO NOTHING");
      }
      return existing;
    },

    /**
     * Billing-uppslaget är alltid sanningen för DEN HÄR inloggningen:
     * upsertar varje aktuellt (tenant, kund)-par, och tar bort länkar vars
     * tenant inte längre finns i träfflistan (personen är t.ex. inte
     * längre kund där). Enklast korrekta modell (architecture.md #24) —
     * ingen historik över borttagna länkar i denna fas.
     */
    async syncCompanyLinks(
      tx: TransactionSql,
      userId: number,
      matches: { tenantId: number; customerId: number }[],
    ): Promise<void> {
      for (const match of matches) {
        await tx`
          INSERT INTO user_company_links (user_id, tenant_id, customer_id)
          VALUES (${userId}, ${match.tenantId}, ${match.customerId})
          ON CONFLICT (user_id, tenant_id) DO UPDATE SET customer_id = EXCLUDED.customer_id
        `;
      }
      const tenantIds = matches.map((m) => m.tenantId);
      if (tenantIds.length === 0) {
        await tx`DELETE FROM user_company_links WHERE user_id = ${userId}`;
      } else {
        await tx`
          DELETE FROM user_company_links
          WHERE user_id = ${userId} AND tenant_id NOT IN ${tx(tenantIds)}
        `;
      }
    },

    /** Sorterad senast använd → äldst skapad, så växlaren kan visa senaste företaget först. */
    async listCompanyLinks(userId: number): Promise<CompanyLink[]> {
      return sql<CompanyLink[]>`
        SELECT l.tenant_id, l.customer_id, t.name AS tenant_name
        FROM user_company_links l
        JOIN tenants t ON t.id = l.tenant_id
        WHERE l.user_id = ${userId}
        -- id ASC som sista tiebreak: syncCompanyLinks upsertar flera länkar
        -- i SAMMA transaktion, så created_at kan bli identisk för alla
        -- (Postgres now() är fryst per transaktion) vid en persons FÖRSTA
        -- inloggning med träff hos flera tenants samtidigt. Utan en
        -- deterministisk sista tiebreak vore vilken länk som blir den
        -- aktiva sessionen (collect()s links[0]) odefinierat (kodgranskning
        -- fas 12). id är GENERATED ALWAYS AS IDENTITY — stigande i
        -- insättningsordning, alltid unikt.
        ORDER BY l.last_used_at DESC NULLS LAST, l.created_at ASC, l.id ASC
      `;
    },

    async touchLink(userId: number, tenantId: number): Promise<void> {
      await sql`
        UPDATE user_company_links SET last_used_at = now()
        WHERE user_id = ${userId} AND tenant_id = ${tenantId}
      `;
    },

    /** Byt-företag-kontrollen: finns INGEN rad, är tenantId inte länkat till den här identiteten. */
    async findLink(
      userId: number,
      tenantId: number,
    ): Promise<{ tenant_id: number; customer_id: number } | undefined> {
      const [row] = await sql<{ tenant_id: number; customer_id: number }[]>`
        SELECT tenant_id, customer_id FROM user_company_links
        WHERE user_id = ${userId} AND tenant_id = ${tenantId}
        LIMIT 1
      `;
      return row;
    },

    async getTenantStatus(tenantId: number): Promise<string | undefined> {
      const [row] = await sql<{ status: string }[]>`
        SELECT status FROM tenants WHERE id = ${tenantId} LIMIT 1
      `;
      return row?.status;
    },
  };
}

export type BankIdRepository = ReturnType<typeof createBankIdRepository>;

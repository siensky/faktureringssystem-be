// Affärslogik för customers. Formkrav som databasens CHECK också vaktar
// (company -> orgNumber, private -> pnr) valideras här för ett begripligt
// felmeddelande. Personnumret kanoniseras till 12 siffror + kontrollsiffra
// (@faktura/shared) INNAN kryptering/HMAC, så customers.pnr_hmac matchar
// users.pnr_hash för samma person. Auditrader skrivs i samma transaktion
// som ändringen (audit.ts).

import {
  BadRequest,
  Conflict,
  NotFound,
  type RequestContext,
  encryptField,
  hmacField,
  isValidOrgNumber,
  isValidPnr,
  normalizePnr,
} from "@faktura/shared";
import type { Sql, TransactionSql } from "postgres";
import { writeAuditLog } from "../audit";
import { toInternalView, toView } from "./mappers";
import { CustomerRepository } from "./repository";
import type { CreateCustomerInput, UpdateCustomerInput } from "./types";

interface Deps {
  sql: Sql;
  pnrEncryptionKey: string;
  pnrHmacKey: string;
}

const PAGE_DEFAULT = 100;
const PAGE_MAX = 200;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23503"
  );
}

export function createCustomerService(deps: Deps) {
  const repo = (ctx: RequestContext) => new CustomerRepository(deps.sql, ctx);

  return {
    /** Körs inuti withIdempotency:s transaktion. Returnerar API-svaret. */
    async createInTx(ctx: RequestContext, tx: TransactionSql, input: CreateCustomerInput) {
      let orgNumber: string | null = null;
      let pnrEncrypted: string | null = null;
      let pnrHmac: string | null = null;

      if (input.customerType === "company") {
        if (!input.orgNumber) throw new BadRequest("Företagskund kräver orgNumber");
        if (!isValidOrgNumber(input.orgNumber)) {
          throw new BadRequest("Ogiltigt organisationsnummer");
        }
        orgNumber = input.orgNumber;
      } else {
        if (!input.pnr) throw new BadRequest("Privatkund kräver pnr");
        if (!isValidPnr(input.pnr)) throw new BadRequest("Ogiltigt personnummer");
        const canonical = normalizePnr(input.pnr); // 12 siffror
        pnrEncrypted = encryptField(canonical, deps.pnrEncryptionKey);
        pnrHmac = hmacField(canonical, deps.pnrHmacKey);
      }

      let row: Awaited<ReturnType<CustomerRepository["insert"]>>;
      try {
        row = await new CustomerRepository(deps.sql, ctx).insert(tx, {
          customerType: input.customerType,
          name: input.name,
          email: input.email,
          orgNumber,
          pnrEncrypted,
          pnrHmac,
          addressStreet: input.addressStreet ?? null,
          addressZip: input.addressZip ?? null,
          addressCity: input.addressCity ?? null,
          paymentTermsDays: input.paymentTermsDays ?? null,
        });
      } catch (error) {
        // customers_pnr_hmac_key: samma person finns redan som kund.
        if (isUniqueViolation(error)) {
          throw new Conflict("En kund med det personnumret finns redan");
        }
        throw error;
      }

      await writeAuditLog(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: "customer.created",
        resourceType: "customer",
        resourceId: String(row.id),
        correlationId: ctx.correlationId,
        metadata: { customerType: row.customer_type },
      });

      return { status: 201, body: toView(row) };
    },

    async list(ctx: RequestContext, page: { limit?: number; offset?: number }) {
      const limit = Math.min(page.limit ?? PAGE_DEFAULT, PAGE_MAX);
      const offset = page.offset ?? 0;
      // Hämta en extra rad för att kunna säga om det finns fler.
      const rows = await repo(ctx).list(limit + 1, offset);
      const hasMore = rows.length > limit;
      return { items: rows.slice(0, limit).map(toView), hasMore };
    },

    async get(ctx: RequestContext, id: number) {
      const row = await repo(ctx).findById(id);
      if (!row) throw new NotFound("Kunden finns inte");
      return toView(row);
    },

    async update(ctx: RequestContext, id: number, input: UpdateCustomerInput) {
      const existing = await repo(ctx).findById(id);
      if (!existing) throw new NotFound("Kunden finns inte");
      if (input.orgNumber !== undefined) {
        if (existing.customer_type !== "company") {
          throw new BadRequest("orgNumber kan bara sättas på företagskunder");
        }
        if (!isValidOrgNumber(input.orgNumber)) {
          throw new BadRequest("Ogiltigt organisationsnummer");
        }
      }

      const columns: Record<string, string | number | null> = {};
      if (input.name !== undefined) columns.name = input.name;
      if (input.email !== undefined) columns.email = input.email;
      if (input.orgNumber !== undefined) columns.org_number = input.orgNumber;
      if (input.addressStreet !== undefined) columns.address_street = input.addressStreet;
      if (input.addressZip !== undefined) columns.address_zip = input.addressZip;
      if (input.addressCity !== undefined) columns.address_city = input.addressCity;
      if (input.paymentTermsDays !== undefined) {
        columns.payment_terms_days = input.paymentTermsDays;
      }
      if (Object.keys(columns).length === 0) return toView(existing);

      return deps.sql.begin(async (tx) => {
        const row = await new CustomerRepository(deps.sql, ctx).update(id, columns, tx);
        if (!row) throw new NotFound("Kunden finns inte");
        await writeAuditLog(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: "customer.updated",
          resourceType: "customer",
          resourceId: String(id),
          correlationId: ctx.correlationId,
          metadata: { fields: Object.keys(columns) },
        });
        return toView(row);
      });
    },

    async remove(ctx: RequestContext, id: number) {
      return deps.sql.begin(async (tx) => {
        const r = new CustomerRepository(deps.sql, ctx);
        let deleted: number;
        try {
          deleted = await r.remove(id, tx);
        } catch (error) {
          // FK RESTRICT från invoices/invoice_templates: kunden ingår i en
          // bokföringspost och får inte raderas (domain.md #21 —
          // anonymisering, inte radering, byggs i en senare fas).
          if (isForeignKeyViolation(error)) {
            throw new Conflict("Kunden har fakturor eller mallar och kan inte raderas");
          }
          throw error;
        }
        if (deleted === 0) throw new NotFound("Kunden finns inte");

        await writeAuditLog(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: "customer.deleted",
          resourceType: "customer",
          resourceId: String(id),
          correlationId: ctx.correlationId,
        });
        return { status: "ok" as const };
      });
    },

    async getForService(ctx: RequestContext, id: number) {
      const row = await repo(ctx).findById(id);
      if (!row) throw new NotFound("Kunden finns inte");
      return toInternalView(row);
    },
  };
}

export type CustomerService = ReturnType<typeof createCustomerService>;

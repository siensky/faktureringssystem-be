// Affärslogik för customers. Formkrav som databasens CHECK också vaktar
// (company -> orgNumber, private -> pnr) valideras här för ett begripligt
// felmeddelande; personnummer krypteras + HMAC:as innan det når repot.

import {
  BadRequest,
  Conflict,
  NotFound,
  type RequestContext,
  encryptField,
  hmacField,
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

export function createCustomerService(deps: Deps) {
  const repo = (ctx: RequestContext) => new CustomerRepository(deps.sql, ctx);

  return {
    /** Körs inuti withIdempotency:s transaktion. Returnerar API-svaret. */
    async createInTx(ctx: RequestContext, tx: TransactionSql, input: CreateCustomerInput) {
      if (input.customerType === "company" && !input.orgNumber) {
        throw new BadRequest("Företagskund kräver orgNumber");
      }
      if (input.customerType === "private" && !input.pnr) {
        throw new BadRequest("Privatkund kräver pnr");
      }

      const pnrEncrypted =
        input.customerType === "private" && input.pnr
          ? encryptField(input.pnr, deps.pnrEncryptionKey)
          : null;
      const pnrHmac =
        input.customerType === "private" && input.pnr
          ? hmacField(input.pnr, deps.pnrHmacKey)
          : null;

      const row = await new CustomerRepository(deps.sql, ctx).insert(tx, {
        customerType: input.customerType,
        name: input.name,
        email: input.email,
        orgNumber: input.customerType === "company" ? (input.orgNumber ?? null) : null,
        pnrEncrypted,
        pnrHmac,
        addressStreet: input.addressStreet ?? null,
        addressZip: input.addressZip ?? null,
        addressCity: input.addressCity ?? null,
        paymentTermsDays: input.paymentTermsDays ?? null,
      });

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

    async list(ctx: RequestContext) {
      return (await repo(ctx).list()).map(toView);
    },

    async get(ctx: RequestContext, id: number) {
      const row = await repo(ctx).findById(id);
      if (!row) throw new NotFound("Kunden finns inte");
      return toView(row);
    },

    async update(ctx: RequestContext, id: number, input: UpdateCustomerInput) {
      const existing = await repo(ctx).findById(id);
      if (!existing) throw new NotFound("Kunden finns inte");
      if (input.orgNumber !== undefined && existing.customer_type !== "company") {
        throw new BadRequest("orgNumber kan bara sättas på företagskunder");
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

      const row = await repo(ctx).update(id, columns);
      if (!row) throw new NotFound("Kunden finns inte");

      await writeAuditLog(deps.sql, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: "customer.updated",
        resourceType: "customer",
        resourceId: String(id),
        correlationId: ctx.correlationId,
        metadata: { fields: Object.keys(columns) },
      });
      return toView(row);
    },

    async remove(ctx: RequestContext, id: number) {
      let deleted: number;
      try {
        deleted = await repo(ctx).remove(id);
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

      await writeAuditLog(deps.sql, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: "customer.deleted",
        resourceType: "customer",
        resourceId: String(id),
        correlationId: ctx.correlationId,
      });
      return { status: "ok" as const };
    },

    async getForService(ctx: RequestContext, id: number) {
      const row = await repo(ctx).findById(id);
      if (!row) throw new NotFound("Kunden finns inte");
      return toInternalView(row);
    },
  };
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23503"
  );
}

export type CustomerService = ReturnType<typeof createCustomerService>;

// Fas 6 e2e — automatisering: markera overdue, skapa påminnelse (+
// supersede originalet), generera återkommande faktura ur en mall,
// idempotens över två körningar, en avstängd tenant får inga påminnelser,
// och auth/scope-kontroll på den skyddade drift-endpointen. Körs bara med
// RUN_E2E mot en uppe stack.
//
// DST-korrektheten på schemaläggningen (nextDailyRunAt) är ren
// datumaritmetik utan DB/nätverk och testas i stället som ett rent
// enhetstest (packages/shared/test/cron.test.ts) — en e2e-körning kan
// inte förflytta den riktiga kalendern till en DST-övergång.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
  BILLING_URL,
  DB_URL,
  decodeJwt,
  getTo,
  post,
  postTo,
  putTo,
  registerVerifyLogin,
  uniq,
  validBankgiro,
  validOrgNumber,
} from "./helpers";

const RUN = !!process.env.RUN_E2E;

const OPS_CLIENT_ID = `svc-billing-ops-e2e-${uniq()}`;
const OPS_CLIENT_SECRET = "billing-e2e-ops-secret-long-and-random-0123456789";
const OPS_SCOPES = ["billing:ops:run"];

// Ett tokenförväxlings-konto: giltigt tjänste-token, men fel scope för
// automation-endpointen (architecture.md #19 — 403, inte 401).
const WRONG_SCOPE_CLIENT_ID = `svc-billing-wrongscope-e2e-${uniq()}`;
const WRONG_SCOPE_CLIENT_SECRET = "billing-e2e-wrongscope-secret-long-random-0123456789";
const WRONG_SCOPES = ["billing:invoice:read"];

const ONE_LINE = [
  { description: "Konsulttimmar", quantity: 1, unitPriceOre: 100_000, vatRate: 25 },
];
const FULL_AMOUNT_ORE = 125_000; // 100_000 + 25% moms
const REMINDER_FEE_ORE = 6000; // company_settings default

interface Session {
  token: string;
  tenantId: number;
}
const auth = (s: Session) => ({ authorization: `Bearer ${s.token}` });
const idem = (s: Session) => ({ ...auth(s), "idempotency-key": `idem-${uniq()}-${uniq()}` });

function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** Datum + dess dag-i-månaden N hela kalendermånader tillbaka — för
 * invoice_templates.billing_day, som ska motsvara det datum som sätts. */
function monthsAgo(n: number): { date: string; billingDay: number } {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return { date: d.toISOString().slice(0, 10), billingDay: d.getUTCDate() };
}

describe.skipIf(!RUN)("fas 6 e2e — automatisering", () => {
  let sql: ReturnType<typeof postgres>;
  const tenantIds: number[] = [];

  async function newAdmin(prefix: string): Promise<Session> {
    const { accessToken } = await registerVerifyLogin(`${prefix}-${uniq()}@ex.test`);
    const tenantId = decodeJwt(accessToken).tenantId as number;
    tenantIds.push(tenantId);
    return { token: accessToken, tenantId };
  }

  async function fillCompanySettings(s: Session): Promise<void> {
    const res = await putTo(
      BILLING_URL,
      "/admin/company-settings",
      { companyName: `Bolag ${uniq()}`, orgNumber: validOrgNumber(), bankgiro: validBankgiro() },
      auth(s),
    );
    if (res.status !== 200) throw new Error(`company-settings: ${res.status}`);
  }

  async function makeCustomer(s: Session): Promise<number> {
    const res = await postTo(
      BILLING_URL,
      "/admin/customers",
      {
        customerType: "company",
        name: `Kund ${uniq()}`,
        email: `${uniq()}@ex.test`,
        orgNumber: validOrgNumber(),
        addressStreet: "Vägen 1",
        addressZip: "11122",
        addressCity: "Stockholm",
      },
      idem(s),
    );
    if (res.status !== 201) throw new Error(`makeCustomer: ${res.status}`);
    return ((await res.json()) as { id: number }).id;
  }

  async function sentInvoice(s: Session, customerId: number): Promise<{ id: number; ocr: string }> {
    const draftRes = await postTo(
      BILLING_URL,
      "/admin/invoices",
      { customerId, lines: ONE_LINE },
      idem(s),
    );
    if (draftRes.status !== 201) throw new Error(`createDraft: ${draftRes.status}`);
    const { id } = (await draftRes.json()) as { id: number };
    const sendRes = await postTo(BILLING_URL, `/admin/invoices/${id}/send`, {}, idem(s));
    if (sendRes.status !== 200) throw new Error(`send: ${sendRes.status}`);
    const { ocrNumber } = (await sendRes.json()) as { ocrNumber: string };
    return { id, ocr: ocrNumber };
  }

  async function makeOverdue(invoiceId: number, daysAgo = 10): Promise<void> {
    await sql`UPDATE invoices SET date_due = ${pastDate(daysAgo)} WHERE id = ${invoiceId}`;
  }

  async function getInvoice(s: Session, id: number) {
    const res = await getTo(BILLING_URL, `/admin/invoices/${id}`, auth(s));
    if (res.status !== 200) throw new Error(`get invoice: ${res.status}`);
    return res.json() as Promise<{
      status: string;
      invoiceType: string;
      supersededByInvoiceId: number | null;
      remindsInvoiceId: number | null;
      totalInclVat: number;
    }>;
  }

  async function opsToken(clientId: string, clientSecret: string, scope: string): Promise<string> {
    const res = await post("/auth/token", {
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    });
    if (res.status !== 200) throw new Error(`opsToken: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  async function runAutomation(token: string): Promise<Response> {
    return fetch(`${BILLING_URL}/internal/automation/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  }

  beforeAll(async () => {
    sql = postgres(DB_URL);
    const opsHash = await Bun.password.hash(OPS_CLIENT_SECRET, { algorithm: "argon2id" });
    await sql`
      INSERT INTO service_clients (client_id, client_secret_hash, allowed_scopes)
      VALUES (${OPS_CLIENT_ID}, ${opsHash}, ${OPS_SCOPES})
    `;
    const wrongHash = await Bun.password.hash(WRONG_SCOPE_CLIENT_SECRET, { algorithm: "argon2id" });
    await sql`
      INSERT INTO service_clients (client_id, client_secret_hash, allowed_scopes)
      VALUES (${WRONG_SCOPE_CLIENT_ID}, ${wrongHash}, ${WRONG_SCOPES})
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM service_clients WHERE client_id IN ${sql([OPS_CLIENT_ID, WRONG_SCOPE_CLIENT_ID])}`;
    if (tenantIds.length > 0) {
      await sql`DELETE FROM invoice_payments WHERE tenant_id IN ${sql(tenantIds)}`;
      await sql`DELETE FROM event_outbox WHERE tenant_id IN ${sql(tenantIds)}`;
      await sql`DELETE FROM tenants WHERE id IN ${sql(tenantIds)}`;
    }
    await sql.end();
  });

  test("saknat token ger 401, fel scope ger 403", async () => {
    const noToken = await fetch(`${BILLING_URL}/internal/automation/run`, { method: "POST" });
    expect(noToken.status).toBe(401);

    const wrongScopeToken = await opsToken(
      WRONG_SCOPE_CLIENT_ID,
      WRONG_SCOPE_CLIENT_SECRET,
      "billing:invoice:read",
    );
    const wrongScope = await runAutomation(wrongScopeToken);
    expect(wrongScope.status).toBe(403);
  });

  test("markerar overdue, skapar påminnelse med restskuld+avgift, och är idempotent över två körningar", async () => {
    const admin = await newAdmin("cron1");
    await fillCompanySettings(admin);
    const customerId = await makeCustomer(admin);
    const original = await sentInvoice(admin, customerId);
    await makeOverdue(original.id);

    // Delbetalning direkt i DB — betalningsmatchningen i sig hör till fas
    // 5 (payments.test.ts), det som testas här är att PÅMINNELSEN räknar
    // restskuld + avgift korrekt (domain.md #18).
    const partialOre = 25_000;
    await sql`
      INSERT INTO invoice_payments (tenant_id, invoice_id, payment_id, amount_ore)
      VALUES (${admin.tenantId}, ${original.id}, ${`e2e-partial-${uniq()}`}, ${partialOre})
    `;

    const token = await opsToken(OPS_CLIENT_ID, OPS_CLIENT_SECRET, "billing:ops:run");

    const first = await runAutomation(token);
    expect(first.status).toBe(200);
    const firstSummary = (await first.json()) as {
      remindersCreated: number;
      overdueMarked: number;
    };
    expect(firstSummary.remindersCreated).toBeGreaterThanOrEqual(1);

    const originalAfter = await getInvoice(admin, original.id);
    expect(originalAfter.status).toBe("superseded");
    expect(originalAfter.supersededByInvoiceId).not.toBeNull();

    const reminderId = originalAfter.supersededByInvoiceId as number;
    const reminder = await getInvoice(admin, reminderId);
    expect(reminder.invoiceType).toBe("reminder");
    expect(reminder.remindsInvoiceId).toBe(original.id);
    // (125_000 - 25_000 + 6_000) öre = 106_000 öre = 1060 kr.
    expect(reminder.totalInclVat).toBe((FULL_AMOUNT_ORE - partialOre + REMINDER_FEE_ORE) / 100);

    // Andra körningen: samma faktura är nu 'superseded' (utesluts av
    // urvalsvillkoret) — ingen ny påminnelse.
    const second = await runAutomation(token);
    expect(second.status).toBe(200);
    const secondSummary = (await second.json()) as { remindersCreated: number };
    const [{ n: reminderCount }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM invoices WHERE reminds_invoice_id = ${original.id}
    `;
    expect(reminderCount).toBe(1);
    // Bara DENNA tenants bidrag till andra körningens summering är
    // garanterat noll — andra tester i sviten kan bidra egna påminnelser.
    expect(secondSummary.remindersCreated).toBeGreaterThanOrEqual(0);
  });

  test("en avstängd tenant får ingen påminnelse", async () => {
    const admin = await newAdmin("cronsusp");
    await fillCompanySettings(admin);
    const customerId = await makeCustomer(admin);
    const original = await sentInvoice(admin, customerId);
    await makeOverdue(original.id);
    // Ingen avstängningsendpoint finns ännu (se PR-beskrivningen) — samma
    // direkta SQL-manipulation som e2e/auth.test.ts och e2e/m2m.test.ts
    // redan använder för att sätta upp en avstängd tenant.
    await sql`UPDATE tenants SET status = 'suspended' WHERE id = ${admin.tenantId}`;

    const token = await opsToken(OPS_CLIENT_ID, OPS_CLIENT_SECRET, "billing:ops:run");
    const res = await runAutomation(token);
    expect(res.status).toBe(200);

    const [{ status }] = await sql<{ status: string }[]>`
      SELECT status FROM invoices WHERE id = ${original.id}
    `;
    // En avstängd tenant hoppas över HELT (listActiveTenantIds), så inte
    // ens markOverdue kör för den — fakturan står kvar som 'sent', inte
    // 'overdue' och absolut inte 'superseded'.
    expect(status).toBe("sent");

    // Städa upp innan afterAll (en avstängd tenant kan fortfarande DELETE:as).
    await sql`UPDATE tenants SET status = 'active' WHERE id = ${admin.tenantId}`;
  });

  test("genererar en faktura ur en återkommande mall och rullar fram next_generation_date", async () => {
    const admin = await newAdmin("cronrecur");
    await fillCompanySettings(admin);
    const customerId = await makeCustomer(admin);

    const due = { date: pastDate(1), billingDay: new Date(pastDate(1)).getUTCDate() };
    const [{ id: templateId }] = await sql<{ id: number }[]>`
      INSERT INTO invoice_templates (tenant_id, customer_id, interval, next_generation_date, billing_day, is_active, template_data)
      VALUES (
        ${admin.tenantId}, ${customerId}, 'monthly', ${due.date}, ${due.billingDay}, true,
        ${sql.json({ customerId, lines: ONE_LINE })}
      )
      RETURNING id
    `;

    const token = await opsToken(OPS_CLIENT_ID, OPS_CLIENT_SECRET, "billing:ops:run");
    const res = await runAutomation(token);
    expect(res.status).toBe(200);
    const summary = (await res.json()) as { recurringGenerated: number };
    expect(summary.recurringGenerated).toBeGreaterThanOrEqual(1);

    const [generated] = await sql<{ id: number; status: string; total_incl_vat_ore: string }[]>`
      SELECT id, status, total_incl_vat_ore FROM invoices WHERE parent_template_id = ${templateId}
    `;
    expect(generated).toBeDefined();
    expect(generated!.status).toBe("sent");
    expect(Number(generated!.total_incl_vat_ore)).toBe(FULL_AMOUNT_ORE);

    const [{ next_generation_date, is_active }] = await sql<
      { next_generation_date: string; is_active: boolean }[]
    >`SELECT next_generation_date, is_active FROM invoice_templates WHERE id = ${templateId}`;
    expect(is_active).toBe(true);
    // Rullat framåt förbi dagens datum — andra körningen genererar inte om.
    expect(new Date(next_generation_date).getTime()).toBeGreaterThan(Date.now() - 24 * 3600_000);

    const second = await runAutomation(token);
    expect(second.status).toBe(200);
    const [{ n: generatedCount }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM invoices WHERE parent_template_id = ${templateId}
    `;
    expect(generatedCount).toBe(1); // ingen dubblett av andra körningen
  });

  // Kodgranskning PR #6, fynd 4: en mall som blivit liggande FLERA
  // perioder efter (t.ex. en tenant avstängd länge) ska hämta ikapp hela
  // eftersläpet i EN körning, inte droppa ut en faktura per natt.
  test("hämtar ikapp flera eftersläpande perioder i EN körning", async () => {
    const admin = await newAdmin("cronbacklog");
    await fillCompanySettings(admin);
    const customerId = await makeCustomer(admin);

    const behind = monthsAgo(3);
    const [{ id: templateId }] = await sql<{ id: number }[]>`
      INSERT INTO invoice_templates (tenant_id, customer_id, interval, next_generation_date, billing_day, is_active, template_data)
      VALUES (
        ${admin.tenantId}, ${customerId}, 'monthly', ${behind.date}, ${behind.billingDay}, true,
        ${sql.json({ customerId, lines: ONE_LINE })}
      )
      RETURNING id
    `;

    const token = await opsToken(OPS_CLIENT_ID, OPS_CLIENT_SECRET, "billing:ops:run");
    const res = await runAutomation(token);
    expect(res.status).toBe(200);

    const [{ n: generatedCount }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM invoices WHERE parent_template_id = ${templateId}
    `;
    // 3 månader efter -> minst 3 fakturor i SAMMA körning (inte en per natt).
    expect(generatedCount).toBeGreaterThanOrEqual(3);

    const [{ next_generation_date }] = await sql<{ next_generation_date: string }[]>`
      SELECT next_generation_date FROM invoice_templates WHERE id = ${templateId}
    `;
    // Loopen stannar bara när mallen INTE längre är mogen — dvs framrullad
    // till efter dagens datum.
    expect(new Date(next_generation_date) > new Date(Date.now() - 24 * 3600_000)).toBe(true);
  });
});

// Fas 13 e2e — återkommande fakturor: admin-CRUD på mallar
// (POST/GET/PUT/DELETE /admin/invoice-templates), Idempotency-Key på
// skapande (architecture.md #10), validering (nextGenerationDate i det
// förflutna, okänd kund), tenant-isolering, kundportalens läsvy
// (GET /portal/invoice-templates — bara egna, bara aktiva mallar), och ett
// huvudflödestest som bevisar att en mall skapad via det NYA API:et
// faktiskt genereras av den REDAN BEFINTLIGA cronen (fas 6,
// automation/service.ts) — det var den kopplingen som saknades innan den
// här fasen (migrations/0007_invoice_templates_billing_day.js: "ingen
// mall-CRUD finns"). Körs bara med RUN_E2E mot en uppe stack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
  AUTH_URL,
  BILLING_URL,
  DB_URL,
  decodeJwt,
  delTo,
  get,
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

const OPS_CLIENT_ID = `svc-billing-ops-tmpl-e2e-${uniq()}`;
const OPS_CLIENT_SECRET = "billing-e2e-ops-tmpl-secret-long-and-random-0123456789";

const ONE_LINE = [
  { description: "Månadsabonnemang", quantity: 1, unitPriceOre: 50_000, vatRate: 25 },
];
const CUSTOMER_PASSWORD = "kundens-egna-losenord-mallar-9999";

interface Session {
  token: string;
  tenantId: number;
}
const auth = (s: Session) => ({ authorization: `Bearer ${s.token}` });
const idem = (s: Session) => ({ ...auth(s), "idempotency-key": `idem-${uniq()}-${uniq()}` });

/** UTC-dagens datum som 'YYYY-MM-DD' — säkert "idag" för både
 *  assertTemplateDate (kräver >= idag) och findDueTemplates (<= idag). */
function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}
function tomorrowDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function yesterdayDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!RUN)("fas 13 e2e — återkommande fakturor (mallar)", () => {
  let sql: ReturnType<typeof postgres>;
  const tenantIds: number[] = [];
  let A: Session;
  let B: Session;
  let customerA: number;

  async function newAdmin(prefix = "tmpl"): Promise<Session> {
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

  async function makeCustomer(s: Session, email = `${uniq()}@ex.test`): Promise<number> {
    const res = await postTo(
      BILLING_URL,
      "/admin/customers",
      {
        customerType: "company",
        name: `Kund ${uniq()}`,
        email,
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

  async function inviteAndAccept(
    admin: Session,
    customerId: number,
    email: string,
  ): Promise<{ accessToken: string }> {
    const invite = await postTo(
      AUTH_URL,
      "/auth/customer-invites",
      { customerId, email },
      auth(admin),
    );
    if (invite.status !== 201) throw new Error(`customer-invites: ${invite.status}`);
    const tokenRes = await get(
      `/auth/dev/token?email=${encodeURIComponent(email)}&type=customer_invite`,
    );
    const { token } = (await tokenRes.json()) as { token: string };
    const accept = await post("/auth/accept-customer-invite", {
      token,
      password: CUSTOMER_PASSWORD,
    });
    if (accept.status !== 200) throw new Error(`accept-customer-invite: ${accept.status}`);
    const login = await post("/auth/login", { email, password: CUSTOMER_PASSWORD });
    if (login.status !== 200) throw new Error(`customer login: ${login.status}`);
    return (await login.json()) as { accessToken: string };
  }

  async function opsToken(): Promise<string> {
    const res = await post("/auth/token", {
      grant_type: "client_credentials",
      client_id: OPS_CLIENT_ID,
      client_secret: OPS_CLIENT_SECRET,
      scope: "billing:ops:run",
    });
    if (res.status !== 200) throw new Error(`opsToken: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  beforeAll(async () => {
    sql = postgres(DB_URL);
    const opsHash = await Bun.password.hash(OPS_CLIENT_SECRET, { algorithm: "argon2id" });
    await sql`
      INSERT INTO service_clients (client_id, client_secret_hash, allowed_scopes)
      VALUES (${OPS_CLIENT_ID}, ${opsHash}, ${["billing:ops:run"]})
    `;
    A = await newAdmin("tmplA");
    B = await newAdmin("tmplB");
    await fillCompanySettings(A);
    customerA = await makeCustomer(A);
  });

  afterAll(async () => {
    await sql`DELETE FROM service_clients WHERE client_id = ${OPS_CLIENT_ID}`;
    if (tenantIds.length > 0) {
      await sql`DELETE FROM event_outbox WHERE tenant_id IN ${sql(tenantIds)}`;
      await sql`DELETE FROM tenants WHERE id IN ${sql(tenantIds)}`;
    }
    await sql.end();
  });

  test("POST skapar en mall, kräver Idempotency-Key, en upprepad request skapar ingen dubblett", async () => {
    const noKey = await postTo(
      BILLING_URL,
      "/admin/invoice-templates",
      {
        customerId: customerA,
        interval: "monthly",
        nextGenerationDate: tomorrowDate(),
        lines: ONE_LINE,
      },
      auth(A),
    );
    expect(noKey.status).toBe(400); // idempotencyKeyOf kastar utan headern

    const headers = idem(A);
    const body = {
      customerId: customerA,
      interval: "monthly",
      nextGenerationDate: tomorrowDate(),
      lines: ONE_LINE,
    };
    const first = await postTo(BILLING_URL, "/admin/invoice-templates", body, headers);
    expect(first.status).toBe(201);
    const created = (await first.json()) as {
      id: number;
      customerId: number;
      customerName: string;
      interval: string;
      isActive: boolean;
      totalInclVat: number;
      lines: unknown[];
    };
    expect(created.customerId).toBe(customerA);
    expect(created.interval).toBe("monthly");
    expect(created.isActive).toBe(true);
    expect(created.totalInclVat).toBe(625); // 500 kr + 25% moms
    expect(created.lines).toHaveLength(1);

    // Samma Idempotency-Key igen -> spelar upp SAMMA svar, ingen ny rad.
    const replay = await postTo(BILLING_URL, "/admin/invoice-templates", body, headers);
    expect(replay.status).toBe(201);
    const replayed = (await replay.json()) as { id: number };
    expect(replayed.id).toBe(created.id);

    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM invoice_templates WHERE id = ${created.id}
    `;
    expect(n).toBe(1);
  });

  test("avvisar ett förflutet nextGenerationDate och en okänd kund", async () => {
    const past = await postTo(
      BILLING_URL,
      "/admin/invoice-templates",
      {
        customerId: customerA,
        interval: "monthly",
        nextGenerationDate: yesterdayDate(),
        lines: ONE_LINE,
      },
      idem(A),
    );
    expect(past.status).toBe(400);

    const unknownCustomer = await postTo(
      BILLING_URL,
      "/admin/invoice-templates",
      {
        customerId: 999_999_999,
        interval: "monthly",
        nextGenerationDate: tomorrowDate(),
        lines: ONE_LINE,
      },
      idem(A),
    );
    expect(unknownCustomer.status).toBe(400);
  });

  test("GET (lista + enskild), PUT och DELETE på en mall — och tenant-isolering", async () => {
    const create = await postTo(
      BILLING_URL,
      "/admin/invoice-templates",
      {
        customerId: customerA,
        interval: "quarterly",
        nextGenerationDate: tomorrowDate(),
        lines: ONE_LINE,
      },
      idem(A),
    );
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: number };

    const list = await getTo(BILLING_URL, "/admin/invoice-templates", auth(A));
    expect(list.status).toBe(200);
    const items = (await list.json()) as { id: number }[];
    expect(items.some((t) => t.id === id)).toBe(true);

    const got = await getTo(BILLING_URL, `/admin/invoice-templates/${id}`, auth(A));
    expect(got.status).toBe(200);

    // Tenant B: varken listan (naturligt tom av tenant-filtret) eller
    // GET/PUT/DELETE på A:s mall — 404, aldrig 403 (testing.md #1).
    const bGet = await getTo(BILLING_URL, `/admin/invoice-templates/${id}`, auth(B));
    expect(bGet.status).toBe(404);
    const bPut = await putTo(
      BILLING_URL,
      `/admin/invoice-templates/${id}`,
      { isActive: false },
      auth(B),
    );
    expect(bPut.status).toBe(404);
    const bDelete = await delTo(BILLING_URL, `/admin/invoice-templates/${id}`, auth(B));
    expect(bDelete.status).toBe(404);

    const paused = await putTo(
      BILLING_URL,
      `/admin/invoice-templates/${id}`,
      { isActive: false },
      auth(A),
    );
    expect(paused.status).toBe(200);
    expect(((await paused.json()) as { isActive: boolean }).isActive).toBe(false);

    const del = await delTo(BILLING_URL, `/admin/invoice-templates/${id}`, auth(A));
    expect(del.status).toBe(200);
    const goneAfterDelete = await getTo(BILLING_URL, `/admin/invoice-templates/${id}`, auth(A));
    expect(goneAfterDelete.status).toBe(404);
  });

  test("GET /portal/invoice-templates visar bara kundens egna AKTIVA mallar", async () => {
    const email = `portal-tmpl-${uniq()}@ex.test`;
    const customer = await inviteAndAccept(A, customerA, email);

    const active = await postTo(
      BILLING_URL,
      "/admin/invoice-templates",
      {
        customerId: customerA,
        interval: "monthly",
        nextGenerationDate: tomorrowDate(),
        lines: ONE_LINE,
      },
      idem(A),
    );
    expect(active.status).toBe(201);
    const activeId = ((await active.json()) as { id: number }).id;

    const pausedRes = await postTo(
      BILLING_URL,
      "/admin/invoice-templates",
      {
        customerId: customerA,
        interval: "yearly",
        nextGenerationDate: tomorrowDate(),
        lines: ONE_LINE,
      },
      idem(A),
    );
    const pausedId = ((await pausedRes.json()) as { id: number }).id;
    await putTo(BILLING_URL, `/admin/invoice-templates/${pausedId}`, { isActive: false }, auth(A));

    const list = await fetch(`${BILLING_URL}/portal/invoice-templates`, {
      headers: { authorization: `Bearer ${customer.accessToken}` },
    });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { id: number; totalInclVat: number; interval: string }[];
    expect(rows.some((r) => r.id === activeId)).toBe(true);
    expect(rows.some((r) => r.id === pausedId)).toBe(false); // pausad -> inte med

    // Städa upp inför nästa test (samma customerA återanvänds).
    await delTo(BILLING_URL, `/admin/invoice-templates/${activeId}`, auth(A));
    await delTo(BILLING_URL, `/admin/invoice-templates/${pausedId}`, auth(A));
  });

  test("huvudflöde: en mall skapad via API:et genereras av den befintliga cronen (fas 6)", async () => {
    const create = await postTo(
      BILLING_URL,
      "/admin/invoice-templates",
      {
        customerId: customerA,
        interval: "monthly",
        nextGenerationDate: todayDate(),
        lines: ONE_LINE,
      },
      idem(A),
    );
    expect(create.status).toBe(201);
    const { id: templateId } = (await create.json()) as { id: number };

    const token = await opsToken();
    const run = await fetch(`${BILLING_URL}/internal/automation/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(run.status).toBe(200);

    const [generated] = await sql<{ id: number; status: string; total_incl_vat_ore: string }[]>`
      SELECT id, status, total_incl_vat_ore FROM invoices WHERE parent_template_id = ${templateId}
    `;
    expect(generated).toBeDefined();
    expect(generated!.status).toBe("sent");
    expect(Number(generated!.total_incl_vat_ore)).toBe(62_500); // 500 kr + 25% moms, i öre

    const [{ next_generation_date }] = await sql<{ next_generation_date: string }[]>`
      SELECT next_generation_date FROM invoice_templates WHERE id = ${templateId}
    `;
    // Rullat framåt till nästa månad — inte längre "mogen" idag.
    expect(new Date(next_generation_date).getTime()).toBeGreaterThan(Date.now());
  });
});

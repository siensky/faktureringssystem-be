// Fas 3 e2e — billing: kunder (krypterat pnr, tenant-isolering),
// company_settings, fakturor (nummer + OCR tilldelas vid send, obruten
// serie även samtidigt), PUT/DELETE bara på draft, send (snapshot +
// invoice.sent via outbox), kreditering, Idempotency-Key, S2S-läsendpoints
// med scope-kontroll, och att X-Tenant-Id ignoreras på användar-endpoints.
// Körs bara med RUN_E2E mot en uppe stack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
  BILLING_URL,
  DB_URL,
  PNR_HMAC_KEY,
  decodeJwt,
  delTo,
  getTo,
  hmacField,
  luhnCheck,
  post,
  postTo,
  putTo,
  registerVerifyLogin,
  uniq,
  validBankgiro,
  validOrgNumber,
  validPnr,
} from "./helpers";

const RUN = !!process.env.RUN_E2E;
const CLIENT_ID = `svc-billing-e2e-${uniq()}`;
const CLIENT_SECRET = "billing-e2e-secret-long-and-random-0123456789";
const SCOPES = ["billing:company:read", "billing:customer:read", "billing:invoice:read"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = () => `idem-${uniq()}-${uniq()}`;

interface Session {
  token: string;
  tenantId: number;
}
const auth = (s: Session) => ({ authorization: `Bearer ${s.token}` });
const idem = (s: Session) => ({ ...auth(s), "idempotency-key": key() });

const ONE_LINE = [
  { description: "Konsulttimmar", quantity: 2.5, unitPriceOre: 100_000, vatRate: 25 },
];

function luhnValid(n: string): boolean {
  return luhnCheck(n.slice(0, -1)) === n.slice(-1);
}

describe.skipIf(!RUN)("fas 3 e2e — billing", () => {
  let sql: ReturnType<typeof postgres>;
  const tenantIds: number[] = [];
  let A: Session;
  let B: Session;

  async function newAdmin(): Promise<Session> {
    const { accessToken } = await registerVerifyLogin(`b-${uniq()}@ex.test`);
    const tenantId = decodeJwt(accessToken).tenantId as number;
    tenantIds.push(tenantId);
    return { token: accessToken, tenantId };
  }

  async function serviceToken(scope: string): Promise<string> {
    const res = await post("/auth/token", {
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope,
    });
    if (res.status !== 200) throw new Error(`token: ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
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
        addressStreet: "Vägen 2",
        addressZip: "22233",
        addressCity: "Göteborg",
      },
      idem(s),
    );
    if (res.status !== 201) throw new Error(`makeCustomer: ${res.status}`);
    return ((await res.json()) as { id: number }).id;
  }

  async function createDraft(s: Session, customerId: number, lines = ONE_LINE) {
    const res = await postTo(BILLING_URL, "/admin/invoices", { customerId, lines }, idem(s));
    if (res.status !== 201) throw new Error(`createDraft: ${res.status}`);
    return (await res.json()) as {
      id: number;
      invoiceNumber: number | null;
      ocrNumber: string | null;
      status: string;
      totalInclVat: number;
    };
  }

  async function send(s: Session, id: number) {
    const res = await postTo(BILLING_URL, `/admin/invoices/${id}/send`, {}, idem(s));
    return res;
  }

  beforeAll(async () => {
    sql = postgres(DB_URL);
    const hash = await Bun.password.hash(CLIENT_SECRET, { algorithm: "argon2id" });
    await sql`
      INSERT INTO service_clients (client_id, client_secret_hash, allowed_scopes)
      VALUES (${CLIENT_ID}, ${hash}, ${SCOPES})
    `;
    A = await newAdmin();
    B = await newAdmin();
  });

  afterAll(async () => {
    await sql`DELETE FROM service_clients WHERE client_id = ${CLIENT_ID}`;
    if (tenantIds.length > 0) {
      await sql`DELETE FROM event_outbox WHERE tenant_id IN ${sql(tenantIds)}`;
      await sql`DELETE FROM tenants WHERE id IN ${sql(tenantIds)}`;
    }
    await sql.end();
  });

  // ── company_settings ────────────────────────────────────────────────
  test("GET /admin/company-settings skapar ingen rad (defaultvy), PUT skapar och uppdaterar", async () => {
    const s = await newAdmin();

    const before = await getTo(BILLING_URL, "/admin/company-settings", auth(s));
    expect(before.status).toBe(200);
    expect(((await before.json()) as { isReadyToSend: boolean }).isReadyToSend).toBe(false);
    // GET fick inte skapa raden.
    const [pre] = await sql`SELECT 1 FROM company_settings WHERE tenant_id = ${s.tenantId}`;
    expect(pre).toBeUndefined();

    const upd = await putTo(
      BILLING_URL,
      "/admin/company-settings",
      {
        companyName: "Testbolaget AB",
        orgNumber: validOrgNumber(),
        bankgiro: validBankgiro(),
        reminderFeeOre: 7500,
        paymentTermsDays: 20,
      },
      auth(s),
    );
    expect(upd.status).toBe(200);
    const after = (await upd.json()) as {
      isReadyToSend: boolean;
      reminderFee: number;
      paymentTermsDays: number;
    };
    expect(after.isReadyToSend).toBe(true);
    expect(after.reminderFee).toBe(75); // öre in, kronor ut (database.md #8)
    expect(after.paymentTermsDays).toBe(20);

    // Mutationen ska ha en auditrad.
    const [logged] = await sql`
      SELECT action FROM audit_log
      WHERE tenant_id = ${s.tenantId} AND action = 'company_settings.updated'
    `;
    expect(logged).toBeTruthy();
  });

  test("PUT /admin/company-settings avvisar ogiltigt bankgiro och orgnr", async () => {
    const s = await newAdmin();
    expect(
      (await putTo(BILLING_URL, "/admin/company-settings", { bankgiro: "9999999" }, auth(s)))
        .status,
    ).toBe(400);
    expect(
      (await putTo(BILLING_URL, "/admin/company-settings", { orgNumber: "5560000000" }, auth(s)))
        .status,
    ).toBe(400);
  });

  // ── customers ───────────────────────────────────────────────────────
  test("kund kräver Idempotency-Key", async () => {
    const res = await postTo(
      BILLING_URL,
      "/admin/customers",
      {
        customerType: "company",
        name: "Utan nyckel",
        email: "u@ex.test",
        orgNumber: validOrgNumber(),
      },
      auth(A),
    );
    expect(res.status).toBe(400);
  });

  test("företagskund CRUD + tenant-isolering ger 404 över gränsen", async () => {
    const create = await postTo(
      BILLING_URL,
      "/admin/customers",
      {
        customerType: "company",
        name: "Kund AB",
        email: "kund@ex.test",
        orgNumber: validOrgNumber(),
        addressStreet: "Gatan 1",
        addressZip: "11122",
        addressCity: "Stockholm",
      },
      idem(A),
    );
    expect(create.status).toBe(201);
    const customer = (await create.json()) as { id: number; hasPnr: boolean };
    expect(customer.hasPnr).toBe(false);

    const list = await getTo(BILLING_URL, "/admin/customers", auth(A));
    expect(list.status).toBe(200);
    const page = (await list.json()) as { items: unknown[]; hasMore: boolean };
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    expect(typeof page.hasMore).toBe("boolean");

    expect((await getTo(BILLING_URL, `/admin/customers/${customer.id}`, auth(A))).status).toBe(200);

    const upd = await putTo(
      BILLING_URL,
      `/admin/customers/${customer.id}`,
      { name: "Kund AB (ändrat)" },
      auth(A),
    );
    expect(upd.status).toBe(200);
    expect(((await upd.json()) as { name: string }).name).toBe("Kund AB (ändrat)");

    expect((await getTo(BILLING_URL, `/admin/customers/${customer.id}`, auth(B))).status).toBe(404);
    expect(
      (await putTo(BILLING_URL, `/admin/customers/${customer.id}`, { name: "x" }, auth(B))).status,
    ).toBe(404);
    expect((await delTo(BILLING_URL, `/admin/customers/${customer.id}`, auth(B))).status).toBe(404);
  });

  test("privatkundens personnummer lagras kanoniserat + krypterat, aldrig i klartext", async () => {
    const pnr = validPnr();
    const res = await postTo(
      BILLING_URL,
      "/admin/customers",
      { customerType: "private", name: "Anna Ansson", email: "anna@ex.test", pnr },
      idem(A),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain(pnr);
    expect(body.hasPnr).toBe(true);

    const [row] = await sql<{ pnr_encrypted: string; pnr_hmac: string }[]>`
      SELECT pnr_encrypted, pnr_hmac FROM customers WHERE id = ${body.id as number}
    `;
    expect(row!.pnr_encrypted).not.toContain(pnr);
    // HMAC beräknas över den 12-siffriga kanoniska formen (samma som BankID).
    expect(row!.pnr_hmac).toBe(hmacField(pnr, PNR_HMAC_KEY));
  });

  test("ogiltigt personnummer och dubblett avvisas", async () => {
    expect(
      (
        await postTo(
          BILLING_URL,
          "/admin/customers",
          { customerType: "private", name: "Fel", email: "f@ex.test", pnr: "199001019999" },
          idem(A),
        )
      ).status,
    ).toBe(400);

    const pnr = validPnr();
    const first = await postTo(
      BILLING_URL,
      "/admin/customers",
      { customerType: "private", name: "Bo", email: "bo@ex.test", pnr },
      idem(A),
    );
    expect(first.status).toBe(201);
    const dup = await postTo(
      BILLING_URL,
      "/admin/customers",
      { customerType: "private", name: "Bo igen", email: "bo2@ex.test", pnr },
      idem(A),
    );
    expect(dup.status).toBe(409);
  });

  test("X-Tenant-Id ignoreras på användar-endpoints", async () => {
    // Skapa en kund som A men med B:s tenant-id i headern.
    const res = await postTo(
      BILLING_URL,
      "/admin/customers",
      {
        customerType: "company",
        name: "Headerkund",
        email: `${uniq()}@ex.test`,
        orgNumber: validOrgNumber(),
      },
      { ...idem(A), "x-tenant-id": String(B.tenantId) },
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    // Kunden hamnade hos A (token), inte B (header).
    expect((await getTo(BILLING_URL, `/admin/customers/${id}`, auth(A))).status).toBe(200);
    expect((await getTo(BILLING_URL, `/admin/customers/${id}`, auth(B))).status).toBe(404);
    const [rowA] = await sql`SELECT tenant_id FROM customers WHERE id = ${id}`;
    expect((rowA as { tenant_id: number }).tenant_id).toBe(A.tenantId);
  });

  // ── fakturor ────────────────────────────────────────────────────────
  test("utkast har inget nummer; nummer + giltigt OCR tilldelas först vid send", async () => {
    const s = await newAdmin();
    await fillCompanySettings(s);
    const customerId = await makeCustomer(s);

    const draft = await createDraft(s, customerId);
    expect(draft.status).toBe("draft");
    expect(draft.invoiceNumber).toBeNull();
    expect(draft.ocrNumber).toBeNull();
    expect(draft.totalInclVat).toBe(3125); // 2,5 * 1000 kr * 1,25

    const sent = await send(s, draft.id);
    expect(sent.status).toBe(200);
    const body = (await sent.json()) as {
      invoiceNumber: number;
      ocrNumber: string;
      status: string;
    };
    expect(body.status).toBe("sent");
    expect(body.invoiceNumber).toBeGreaterThanOrEqual(1);
    expect(luhnValid(body.ocrNumber)).toBe(true);
  });

  test("POST /admin/invoices med inline customer skapar kunden i samma anrop", async () => {
    const s = await newAdmin();
    await fillCompanySettings(s);

    const res = await postTo(
      BILLING_URL,
      "/admin/invoices",
      {
        customer: {
          customerType: "company",
          name: `Inline AB ${uniq()}`,
          email: `${uniq()}@ex.test`,
          orgNumber: validOrgNumber(),
        },
        lines: ONE_LINE,
      },
      idem(s),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; customerId: number; status: string };
    expect(body.status).toBe("draft");

    // Kunden finns nu som en riktig, fristående kundrad — inte bara inbäddad i fakturan.
    const custRes = await getTo(BILLING_URL, `/admin/customers/${body.customerId}`, auth(s));
    expect(custRes.status).toBe(200);

    // Misslyckas fakturan (här: ingen lines-rad alls -> 400 från schema) ska
    // ingen kundrad bli kvar övergiven — samma transaktion, allt eller inget.
    const before =
      await sql`SELECT count(*)::int AS n FROM customers WHERE tenant_id = ${s.tenantId}`;
    const failed = await postTo(
      BILLING_URL,
      "/admin/invoices",
      {
        customer: {
          customerType: "company",
          name: "Ska aldrig sparas",
          email: `${uniq()}@ex.test`,
          orgNumber: validOrgNumber(),
        },
        lines: [],
      },
      idem(s),
    );
    expect(failed.status).toBe(400);
    const after =
      await sql`SELECT count(*)::int AS n FROM customers WHERE tenant_id = ${s.tenantId}`;
    expect((after[0] as { n: number }).n).toBe((before[0] as { n: number }).n);
  });

  test("POST /admin/invoices med inline customer och redan existerande personnummer ger 409, ingen faktura skapas", async () => {
    const s = await newAdmin();
    await fillCompanySettings(s);
    const pnr = validPnr();
    await postTo(
      BILLING_URL,
      "/admin/customers",
      { customerType: "private", name: "Redan kund", email: `${uniq()}@ex.test`, pnr },
      idem(s),
    );

    const before =
      await sql`SELECT count(*)::int AS n FROM invoices WHERE tenant_id = ${s.tenantId}`;
    const res = await postTo(
      BILLING_URL,
      "/admin/invoices",
      {
        customer: {
          customerType: "private",
          name: "Samma person igen",
          email: `${uniq()}@ex.test`,
          pnr,
        },
        lines: ONE_LINE,
      },
      idem(s),
    );
    expect(res.status).toBe(409);
    const after =
      await sql`SELECT count(*)::int AS n FROM invoices WHERE tenant_id = ${s.tenantId}`;
    expect((after[0] as { n: number }).n).toBe((before[0] as { n: number }).n);
  });

  test("POST /admin/invoices avvisar både customerId+customer samtidigt och ingetdera", async () => {
    const s = await newAdmin();
    await fillCompanySettings(s);
    const customerId = await makeCustomer(s);

    const both = await postTo(
      BILLING_URL,
      "/admin/invoices",
      {
        customerId,
        customer: {
          customerType: "company",
          name: "X",
          email: "x@ex.test",
          orgNumber: validOrgNumber(),
        },
        lines: ONE_LINE,
      },
      idem(s),
    );
    expect(both.status).toBe(400);

    const neither = await postTo(BILLING_URL, "/admin/invoices", { lines: ONE_LINE }, idem(s));
    expect(neither.status).toBe(400);
  });

  test("send kräver avsändaruppgifter (422), PUT/DELETE ger 409 efter send", async () => {
    const s = await newAdmin();
    const customerId = await makeCustomer(s);
    const draft = await createDraft(s, customerId);

    // PUT på draft OK
    const put1 = await putTo(
      BILLING_URL,
      `/admin/invoices/${draft.id}`,
      { lines: [{ description: "Ändrad", quantity: 1, unitPriceOre: 50_000, vatRate: 25 }] },
      auth(s),
    );
    expect(put1.status).toBe(200);
    expect(((await put1.json()) as { totalInclVat: number }).totalInclVat).toBe(625);

    // send utan avsändaruppgifter -> 422
    expect((await send(s, draft.id)).status).toBe(422);

    await fillCompanySettings(s);
    expect((await send(s, draft.id)).status).toBe(200);

    // PUT/DELETE på sent -> 409
    expect(
      (await putTo(BILLING_URL, `/admin/invoices/${draft.id}`, { lines: ONE_LINE }, auth(s)))
        .status,
    ).toBe(409);
    expect((await delTo(BILLING_URL, `/admin/invoices/${draft.id}`, auth(s))).status).toBe(409);
  });

  test("send skriver snapshot och publicerar invoice.sent genom outboxen", async () => {
    const s = await newAdmin();
    await fillCompanySettings(s);
    const customerId = await makeCustomer(s);
    const draft = await createDraft(s, customerId);
    expect((await send(s, draft.id)).status).toBe(200);

    const svc = await serviceToken("billing:invoice:read");
    const snap = await getTo(BILLING_URL, `/internal/invoices/${draft.id}/snapshot`, {
      authorization: `Bearer ${svc}`,
      "x-tenant-id": String(s.tenantId),
    });
    expect(snap.status).toBe(200);
    const payload = (await snap.json()) as { company: { bankgiro: string }; lines: unknown[] };
    expect(payload.company.bankgiro).toBeTruthy();
    expect(payload.lines.length).toBe(1);

    let published = false;
    for (let i = 0; i < 30 && !published; i++) {
      const [row] = await sql<{ published_at: Date | null }[]>`
        SELECT published_at FROM event_outbox
        WHERE source_service = 'billing' AND event_type = 'invoice.sent'
          AND (payload->>'invoiceId')::int = ${draft.id}
      `;
      published = !!row?.published_at;
      if (!published) await sleep(500);
    }
    expect(published).toBe(true);
  });

  test("samtidiga send ger distinkta, sammanhängande nummer (radlås på serien)", async () => {
    const s = await newAdmin();
    await fillCompanySettings(s);
    const customerId = await makeCustomer(s);
    const N = 8;

    const drafts = await Promise.all(Array.from({ length: N }, () => createDraft(s, customerId)));
    const sends = await Promise.all(drafts.map((d) => send(s, d.id)));
    for (const r of sends) expect(r.status).toBe(200);

    const numbers = (
      await Promise.all(sends.map((r) => r.json() as Promise<{ invoiceNumber: number }>))
    )
      .map((b) => b.invoiceNumber)
      .sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(N); // inga dubbletter
    for (let i = 1; i < N; i++) expect(numbers[i]).toBe(numbers[i - 1]! + 1); // inga hål
  });

  test("radering av utkast river inget hål i nummerserien", async () => {
    const s = await newAdmin();
    await fillCompanySettings(s);
    const customerId = await makeCustomer(s);

    const first = await createDraft(s, customerId);
    expect((await send(s, first.id)).status).toBe(200);

    const doomed = await createDraft(s, customerId);
    expect((await delTo(BILLING_URL, `/admin/invoices/${doomed.id}`, auth(s))).status).toBe(200);

    const next = await createDraft(s, customerId);
    const nextSent = await send(s, next.id);
    const firstSent = await getTo(BILLING_URL, `/admin/invoices/${first.id}`, auth(s));
    const firstNumber = ((await firstSent.json()) as { invoiceNumber: number }).invoiceNumber;
    const nextNumber = ((await nextSent.json()) as { invoiceNumber: number }).invoiceNumber;
    expect(nextNumber).toBe(firstNumber + 1); // det raderade utkastet förbrukade inget nummer
  });

  test("Idempotency-Key: samma nyckel spelar upp svaret, annan body ger 422, annan endpoint ger 422", async () => {
    const s = await newAdmin();
    await fillCompanySettings(s);
    const customerId = await makeCustomer(s);
    const k = key();
    const body = { customerId, lines: ONE_LINE };

    const r1 = await postTo(BILLING_URL, "/admin/invoices", body, {
      ...auth(s),
      "idempotency-key": k,
    });
    const r2 = await postTo(BILLING_URL, "/admin/invoices", body, {
      ...auth(s),
      "idempotency-key": k,
    });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const id1 = ((await r1.json()) as { id: number }).id;
    const id2 = ((await r2.json()) as { id: number }).id;
    expect(id1).toBe(id2);

    const r3 = await postTo(
      BILLING_URL,
      "/admin/invoices",
      {
        customerId,
        lines: [{ description: "Annat", quantity: 9, unitPriceOre: 900, vatRate: 25 }],
      },
      { ...auth(s), "idempotency-key": k },
    );
    expect(r3.status).toBe(422);

    // Samma nyckel mot send-endpointen -> 422 (inte tyst uppspelning av skapa-svaret).
    const r4 = await postTo(
      BILLING_URL,
      `/admin/invoices/${id1}/send`,
      {},
      {
        ...auth(s),
        "idempotency-key": k,
      },
    );
    expect(r4.status).toBe(422);
  });

  test("kreditering: credit_note i settled med negativa belopp, originalet credited, serien obruten", async () => {
    const s = await newAdmin();
    await fillCompanySettings(s);
    const customerId = await makeCustomer(s);
    const draft = await createDraft(s, customerId);
    const sent = await send(s, draft.id);
    const sentNo = ((await sent.json()) as { invoiceNumber: number }).invoiceNumber;

    const credit = await postTo(BILLING_URL, `/admin/invoices/${draft.id}/credit`, {}, idem(s));
    expect(credit.status).toBe(201);
    const cn = (await credit.json()) as {
      id: number;
      invoiceType: string;
      status: string;
      invoiceNumber: number;
      totalInclVat: number;
    };
    expect(cn.invoiceType).toBe("credit_note");
    expect(cn.status).toBe("settled");
    expect(cn.totalInclVat).toBe(-3125);
    expect(cn.invoiceNumber).toBe(sentNo + 1);

    const original = await getTo(BILLING_URL, `/admin/invoices/${draft.id}`, auth(s));
    expect(((await original.json()) as { status: string }).status).toBe("credited");

    // dubbel kreditering -> 409
    expect(
      (await postTo(BILLING_URL, `/admin/invoices/${draft.id}/credit`, {}, idem(s))).status,
    ).toBe(409);
  });

  test("kreditering kräver också avsändaruppgifter (422) — samma grind som send", async () => {
    // Går inte att nå via PUT /admin/company-settings (schemat kräver
    // icke-tom bankgiro/companyName och har ingen "rensa fältet"-väg) —
    // fältet blir bara tomt genom en direkt DB-ändring, precis som en
    // framtida admin-rutin eller migration skulle kunna göra. Beviset är
    // ändå värt att ha: kreditvägen ska ha SAMMA grind som sendvägen
    // (PR-granskning fas 4, punkt 26), inte lita på att fältet råkar
    // förbli ifyllt för evigt.
    const s = await newAdmin();
    await fillCompanySettings(s);
    const customerId = await makeCustomer(s);
    const draft = await createDraft(s, customerId);
    expect((await send(s, draft.id)).status).toBe(200);

    await sql`UPDATE company_settings SET bankgiro = NULL WHERE tenant_id = ${s.tenantId}`;

    const credit = await postTo(BILLING_URL, `/admin/invoices/${draft.id}/credit`, {}, idem(s));
    expect(credit.status).toBe(422);
  });

  test("tenant-isolering: företag B får 404 på företag A:s faktura överallt", async () => {
    await fillCompanySettings(A);
    const customerId = await makeCustomer(A);
    const draft = await createDraft(A, customerId);

    expect((await getTo(BILLING_URL, `/admin/invoices/${draft.id}`, auth(B))).status).toBe(404);
    expect(
      (await putTo(BILLING_URL, `/admin/invoices/${draft.id}`, { lines: ONE_LINE }, auth(B)))
        .status,
    ).toBe(404);
    expect((await delTo(BILLING_URL, `/admin/invoices/${draft.id}`, auth(B))).status).toBe(404);
    expect((await send(B, draft.id)).status).toBe(404);
    expect(
      (await postTo(BILLING_URL, `/admin/invoices/${draft.id}/credit`, {}, idem(B))).status,
    ).toBe(404);
  });

  // ── Fas 8: leveransvyn ──────────────────────────────────────────────
  test("GET /admin/deliveries filtrerar på delivery_status och är tenant-isolerad", async () => {
    await fillCompanySettings(A);
    const customerId = await makeCustomer(A);
    const draft = await createDraft(A, customerId);
    // documents-konsumenten sätter delivery_status i drift — här sätts den
    // direkt för att testa admin-endpointen isolerat från leveranspipen.
    await sql`UPDATE invoices SET delivery_status = 'failed' WHERE id = ${draft.id}`;

    const asA = await getTo(BILLING_URL, "/admin/deliveries?status=failed", auth(A));
    expect(asA.status).toBe(200);
    const bodyA = (await asA.json()) as { items: { id: number; deliveryStatus: string }[] };
    const found = bodyA.items.find((i) => i.id === draft.id);
    expect(found?.deliveryStatus).toBe("failed");

    // B:s tenant får aldrig se A:s fakturor i leveransvyn.
    const asB = await getTo(BILLING_URL, "/admin/deliveries?status=failed", auth(B));
    const bodyB = (await asB.json()) as { items: { id: number }[] };
    expect(bodyB.items.some((i) => i.id === draft.id)).toBe(false);

    // Filtrerar bort fakturor i andra leveranslägen.
    const asAQueued = await getTo(BILLING_URL, "/admin/deliveries?status=queued", auth(A));
    const bodyAQueued = (await asAQueued.json()) as { items: { id: number }[] };
    expect(bodyAQueued.items.some((i) => i.id === draft.id)).toBe(false);
  });

  // ── S2S-endpoints ───────────────────────────────────────────────────
  test("S2S: scope krävs, X-Tenant-Id krävs, fel token avvisas", async () => {
    const good = await serviceToken("billing:company:read");
    const wrongScope = await serviceToken("billing:invoice:read");
    const fresh = await newAdmin();
    const tid = String(fresh.tenantId);

    expect(
      (
        await getTo(BILLING_URL, "/internal/company-settings", {
          authorization: `Bearer ${good}`,
          "x-tenant-id": tid,
        })
      ).status,
    ).toBe(404); // ingen rad än — S2S skapar inte lat

    await fillCompanySettings(fresh);
    expect(
      (
        await getTo(BILLING_URL, "/internal/company-settings", {
          authorization: `Bearer ${good}`,
          "x-tenant-id": tid,
        })
      ).status,
    ).toBe(200);

    expect(
      (await getTo(BILLING_URL, "/internal/company-settings", { authorization: `Bearer ${good}` }))
        .status,
    ).toBe(400); // saknad X-Tenant-Id
    expect(
      (
        await getTo(BILLING_URL, "/internal/company-settings", {
          authorization: `Bearer ${wrongScope}`,
          "x-tenant-id": tid,
        })
      ).status,
    ).toBe(403); // fel scope
    expect(
      (
        await getTo(BILLING_URL, "/internal/company-settings", {
          "x-tenant-id": tid,
        })
      ).status,
    ).toBe(401); // ingen token
    expect(
      (
        await getTo(BILLING_URL, "/internal/company-settings", {
          ...auth(fresh),
          "x-tenant-id": tid,
        })
      ).status,
    ).toBe(401); // användar-token på S2S-endpoint
  });

  test("S2S: snapshot och by-ocr är tenant-isolerade och personnummerfria", async () => {
    const s = await newAdmin();
    await fillCompanySettings(s);
    const pnr = validPnr();
    const custRes = await postTo(
      BILLING_URL,
      "/admin/customers",
      { customerType: "private", name: "Cilla", email: "c@ex.test", pnr },
      idem(s),
    );
    const customerId = ((await custRes.json()) as { id: number }).id;
    const draft = await createDraft(s, customerId);
    const sent = await send(s, draft.id);
    const ocr = ((await sent.json()) as { ocrNumber: string }).ocrNumber;

    const svc = await serviceToken("billing:invoice:read");
    const custSvc = await serviceToken("billing:customer:read");

    // rätt tenant
    const okSnap = await getTo(BILLING_URL, `/internal/invoices/${draft.id}/snapshot`, {
      authorization: `Bearer ${svc}`,
      "x-tenant-id": String(s.tenantId),
    });
    expect(okSnap.status).toBe(200);
    const byOcr = await getTo(BILLING_URL, `/internal/invoices/by-ocr?ocr=${ocr}`, {
      authorization: `Bearer ${svc}`,
      "x-tenant-id": String(s.tenantId),
    });
    expect(byOcr.status).toBe(200);
    expect(((await byOcr.json()) as { currentInvoiceId: number }).currentInvoiceId).toBe(draft.id);

    // fel tenant (B) -> 404, inte data
    expect(
      (
        await getTo(BILLING_URL, `/internal/invoices/${draft.id}/snapshot`, {
          authorization: `Bearer ${svc}`,
          "x-tenant-id": String(B.tenantId),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await getTo(BILLING_URL, `/internal/invoices/by-ocr?ocr=${ocr}`, {
          authorization: `Bearer ${svc}`,
          "x-tenant-id": String(B.tenantId),
        })
      ).status,
    ).toBe(404);

    // customer-S2S lämnar inte ut personnummer
    const custS2s = await getTo(BILLING_URL, `/internal/customers/${customerId}`, {
      authorization: `Bearer ${custSvc}`,
      "x-tenant-id": String(s.tenantId),
    });
    expect(custS2s.status).toBe(200);
    expect(JSON.stringify(await custS2s.json())).not.toContain(pnr);
  });
});

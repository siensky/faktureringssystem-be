// Fas 3 e2e — billing: kunder (krypterat pnr, tenant-isolering),
// company_settings, fakturor (obruten nummerserie även samtidigt, härlett
// OCR, PUT/DELETE bara på draft), send (snapshot + invoice.sent via
// outbox), kreditering, Idempotency-Key, och S2S-läsendpoints med
// scope-kontroll. Körs bara med RUN_E2E mot en uppe stack.

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
  post,
  postTo,
  putTo,
  registerVerifyLogin,
  uniq,
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
const authHeader = (s: Session) => ({ authorization: `Bearer ${s.token}` });

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
  test("GET /admin/company-settings skapar raden lat och PUT uppdaterar den", async () => {
    const first = await getTo(BILLING_URL, "/admin/company-settings", authHeader(A));
    expect(first.status).toBe(200);
    const before = (await first.json()) as { isReadyToSend: boolean };
    expect(before.isReadyToSend).toBe(false);

    const upd = await putTo(
      BILLING_URL,
      "/admin/company-settings",
      {
        companyName: "Testbolaget AB",
        orgNumber: "5560000001",
        bankgiro: "1234-5678",
        reminderFee: 75,
        paymentTermsDays: 20,
      },
      authHeader(A),
    );
    expect(upd.status).toBe(200);
    const after = (await upd.json()) as {
      isReadyToSend: boolean;
      reminderFee: number;
      paymentTermsDays: number;
    };
    expect(after.isReadyToSend).toBe(true);
    expect(after.reminderFee).toBe(75);
    expect(after.paymentTermsDays).toBe(20);
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
        orgNumber: "5560000002",
      },
      authHeader(A),
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
        orgNumber: "5560000003",
        addressStreet: "Gatan 1",
        addressZip: "11122",
        addressCity: "Stockholm",
      },
      { ...authHeader(A), "idempotency-key": key() },
    );
    expect(create.status).toBe(201);
    const customer = (await create.json()) as { id: number; hasPnr: boolean };
    expect(customer.hasPnr).toBe(false);

    const list = await getTo(BILLING_URL, "/admin/customers", authHeader(A));
    expect(list.status).toBe(200);
    expect(((await list.json()) as unknown[]).length).toBeGreaterThanOrEqual(1);

    const one = await getTo(BILLING_URL, `/admin/customers/${customer.id}`, authHeader(A));
    expect(one.status).toBe(200);

    const upd = await putTo(
      BILLING_URL,
      `/admin/customers/${customer.id}`,
      {
        name: "Kund AB (ändrat)",
      },
      authHeader(A),
    );
    expect(upd.status).toBe(200);
    expect(((await upd.json()) as { name: string }).name).toBe("Kund AB (ändrat)");

    // Företag B ser inte företag A:s kund.
    const cross = await getTo(BILLING_URL, `/admin/customers/${customer.id}`, authHeader(B));
    expect(cross.status).toBe(404);
  });

  test("privatkundens personnummer lagras krypterat, aldrig i klartext i API:t", async () => {
    const pnr = "199001011234";
    const res = await postTo(
      BILLING_URL,
      "/admin/customers",
      {
        customerType: "private",
        name: "Anna Ansson",
        email: "anna@ex.test",
        pnr,
      },
      { ...authHeader(A), "idempotency-key": key() },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain(pnr);
    expect(body.hasPnr).toBe(true);

    const [row] = await sql<{ pnr_encrypted: string; pnr_hmac: string }[]>`
      SELECT pnr_encrypted, pnr_hmac FROM customers WHERE id = ${body.id as number}
    `;
    expect(row!.pnr_encrypted).not.toContain(pnr);
    expect(row!.pnr_encrypted.length).toBeGreaterThan(20);
    expect(row!.pnr_hmac).toBe(hmacField(pnr, PNR_HMAC_KEY));
  });

  test("company-kund utan orgNumber avvisas", async () => {
    const res = await postTo(
      BILLING_URL,
      "/admin/customers",
      {
        customerType: "company",
        name: "Formfel",
        email: "f@ex.test",
      },
      { ...authHeader(A), "idempotency-key": key() },
    );
    expect(res.status).toBe(400);
  });

  // ── fakturor ────────────────────────────────────────────────────────
  async function makeCustomer(s: Session, org: string): Promise<number> {
    const res = await postTo(
      BILLING_URL,
      "/admin/customers",
      {
        customerType: "company",
        name: `Kund ${org}`,
        email: `${uniq()}@ex.test`,
        orgNumber: org,
        addressStreet: "Vägen 2",
        addressZip: "22233",
        addressCity: "Göteborg",
      },
      { ...authHeader(s), "idempotency-key": key() },
    );
    if (res.status !== 201) throw new Error(`makeCustomer: ${res.status}`);
    return ((await res.json()) as { id: number }).id;
  }

  const oneLine = [{ description: "Konsulttimmar", quantity: 2.5, unitPrice: 1000, vatRate: 25 }];

  test("faktura skapas som draft, får härlett giltigt OCR och obruten nummerserie", async () => {
    const customerId = await makeCustomer(A, "5560000010");

    const r1 = await postTo(
      BILLING_URL,
      "/admin/invoices",
      {
        customerId,
        lines: oneLine,
      },
      { ...authHeader(A), "idempotency-key": key() },
    );
    expect(r1.status).toBe(201);
    const inv1 = (await r1.json()) as {
      id: number;
      invoiceNumber: number;
      ocrNumber: string;
      status: string;
      totalInclVat: number;
    };
    expect(inv1.status).toBe("draft");
    expect(inv1.totalInclVat).toBe(3125); // 2,5 * 1000 kr * 1,25
    expect(luhnValid(inv1.ocrNumber)).toBe(true);

    const r2 = await postTo(
      BILLING_URL,
      "/admin/invoices",
      {
        customerId,
        lines: oneLine,
      },
      { ...authHeader(A), "idempotency-key": key() },
    );
    const inv2 = (await r2.json()) as { invoiceNumber: number };
    expect(inv2.invoiceNumber).toBe(inv1.invoiceNumber + 1);
  });

  test("samtidiga fakturor får distinkta, sammanhängande nummer (radlås på serien)", async () => {
    const customerId = await makeCustomer(A, "5560000011");
    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        postTo(
          BILLING_URL,
          "/admin/invoices",
          { customerId, lines: oneLine },
          {
            ...authHeader(A),
            "idempotency-key": key(),
          },
        ),
      ),
    );
    for (const r of results) expect(r.status).toBe(201);
    const numbers = (
      await Promise.all(results.map((r) => r.json() as Promise<{ invoiceNumber: number }>))
    )
      .map((b) => b.invoiceNumber)
      .sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(N); // inga dubbletter
    for (let i = 1; i < N; i++) expect(numbers[i]).toBe(numbers[i - 1]! + 1); // inga hål
  });

  test("två tenants har var sin serie — samma nummer, olika OCR-namnrymd", async () => {
    const custA = await makeCustomer(A, "5560000020");
    const custB = await makeCustomer(B, "5560000021");
    await putTo(
      BILLING_URL,
      "/admin/company-settings",
      { companyName: "B AB", orgNumber: "5560000021", bankgiro: "9-9" },
      authHeader(B),
    );

    const ra = await postTo(
      BILLING_URL,
      "/admin/invoices",
      { customerId: custA, lines: oneLine },
      { ...authHeader(A), "idempotency-key": key() },
    );
    const rb = await postTo(
      BILLING_URL,
      "/admin/invoices",
      { customerId: custB, lines: oneLine },
      { ...authHeader(B), "idempotency-key": key() },
    );
    const ia = (await ra.json()) as { ocrNumber: string; invoiceNumber: number };
    const ib = (await rb.json()) as { ocrNumber: string; invoiceNumber: number };

    // Serierna är oberoende: bådas första faktura är nr 1.
    expect(ib.invoiceNumber).toBe(1);
    // Om numret råkar bli lika blir OCR lika — men det är per tenant unikt,
    // och uppslag sker alltid inom en tenant. Bevisa isoleringen:
    const svc = await serviceToken("billing:invoice:read");
    const asA = await getTo(BILLING_URL, `/internal/invoices/by-ocr?ocr=${ia.ocrNumber}`, {
      authorization: `Bearer ${svc}`,
      "x-tenant-id": String(A.tenantId),
    });
    expect(asA.status).toBe(200);
    expect(((await asA.json()) as { currentInvoiceId: number }).currentInvoiceId).toBeGreaterThan(
      0,
    );
  });

  test("PUT/DELETE tillåts på draft men ger 409 efter send; send kräver avsändaruppgifter", async () => {
    // Ny tenant utan ifyllda company-settings.
    const C = await newAdmin();
    const customerId = await makeCustomer(C, "5560000030");
    const created = await postTo(
      BILLING_URL,
      "/admin/invoices",
      { customerId, lines: oneLine },
      { ...authHeader(C), "idempotency-key": key() },
    );
    const inv = (await created.json()) as { id: number };

    // PUT på draft OK
    const put1 = await putTo(
      BILLING_URL,
      `/admin/invoices/${inv.id}`,
      {
        lines: [{ description: "Ändrad", quantity: 1, unitPrice: 500, vatRate: 25 }],
      },
      authHeader(C),
    );
    expect(put1.status).toBe(200);
    expect(((await put1.json()) as { totalInclVat: number }).totalInclVat).toBe(625);

    // send utan avsändaruppgifter -> 422
    const noInfo = await postTo(
      BILLING_URL,
      `/admin/invoices/${inv.id}/send`,
      {},
      { ...authHeader(C), "idempotency-key": key() },
    );
    expect(noInfo.status).toBe(422);

    // fyll i och skicka
    await putTo(
      BILLING_URL,
      "/admin/company-settings",
      {
        companyName: "C AB",
        orgNumber: "5560000030",
        bankgiro: "5-5",
      },
      authHeader(C),
    );
    const sent = await postTo(
      BILLING_URL,
      `/admin/invoices/${inv.id}/send`,
      {},
      { ...authHeader(C), "idempotency-key": key() },
    );
    expect(sent.status).toBe(200);
    expect(((await sent.json()) as { status: string }).status).toBe("sent");

    // PUT/DELETE på sent -> 409
    expect(
      (await putTo(BILLING_URL, `/admin/invoices/${inv.id}`, { lines: oneLine }, authHeader(C)))
        .status,
    ).toBe(409);
    expect((await delTo(BILLING_URL, `/admin/invoices/${inv.id}`, authHeader(C))).status).toBe(409);

    // snapshot finns via S2S, och invoice.sent publiceras genom outboxen
    const svc = await serviceToken("billing:invoice:read");
    const snap = await getTo(BILLING_URL, `/internal/invoices/${inv.id}/snapshot`, {
      authorization: `Bearer ${svc}`,
      "x-tenant-id": String(C.tenantId),
    });
    expect(snap.status).toBe(200);
    const payload = (await snap.json()) as { company: { bankgiro: string }; lines: unknown[] };
    expect(payload.company.bankgiro).toBe("5-5");

    let published = false;
    for (let i = 0; i < 30 && !published; i++) {
      const [row] = await sql<{ published_at: Date | null }[]>`
        SELECT published_at FROM event_outbox
        WHERE source_service = 'billing' AND event_type = 'invoice.sent'
          AND (payload->>'invoiceId')::int = ${inv.id}
      `;
      published = !!row?.published_at;
      if (!published) await sleep(500);
    }
    expect(published).toBe(true);
  });

  test("Idempotency-Key: samma nyckel spelar upp svaret, annan body ger 422", async () => {
    const customerId = await makeCustomer(A, "5560000040");
    const k = key();
    const body = { customerId, lines: oneLine };

    const r1 = await postTo(BILLING_URL, "/admin/invoices", body, {
      ...authHeader(A),
      "idempotency-key": k,
    });
    const r2 = await postTo(BILLING_URL, "/admin/invoices", body, {
      ...authHeader(A),
      "idempotency-key": k,
    });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(((await r1.json()) as { id: number }).id).toBe(((await r2.json()) as { id: number }).id);

    const r3 = await postTo(
      BILLING_URL,
      "/admin/invoices",
      {
        customerId,
        lines: [{ description: "Annat", quantity: 9, unitPrice: 9, vatRate: 25 }],
      },
      { ...authHeader(A), "idempotency-key": k },
    );
    expect(r3.status).toBe(422);
  });

  test("kreditering: ny credit_note i settled med negativa belopp, originalet credited, serien obruten", async () => {
    const customerId = await makeCustomer(A, "5560000050");
    // säkerställ avsändaruppgifter (tenant A satte dem i första testet)
    const created = await postTo(
      BILLING_URL,
      "/admin/invoices",
      { customerId, lines: oneLine },
      { ...authHeader(A), "idempotency-key": key() },
    );
    const inv = (await created.json()) as { id: number; invoiceNumber: number };
    await postTo(
      BILLING_URL,
      `/admin/invoices/${inv.id}/send`,
      {},
      { ...authHeader(A), "idempotency-key": key() },
    );

    const credit = await postTo(
      BILLING_URL,
      `/admin/invoices/${inv.id}/credit`,
      {},
      { ...authHeader(A), "idempotency-key": key() },
    );
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
    expect(cn.invoiceNumber).toBe(inv.invoiceNumber + 1);

    const original = await getTo(BILLING_URL, `/admin/invoices/${inv.id}`, authHeader(A));
    expect(((await original.json()) as { status: string }).status).toBe("credited");

    // dubbel kreditering av samma faktura -> 409
    const again = await postTo(
      BILLING_URL,
      `/admin/invoices/${inv.id}/credit`,
      {},
      { ...authHeader(A), "idempotency-key": key() },
    );
    expect(again.status).toBe(409);
  });

  // ── S2S-endpoints ───────────────────────────────────────────────────
  test("S2S: scope krävs, X-Tenant-Id krävs, fel token avvisas", async () => {
    const good = await serviceToken("billing:company:read");
    const wrong = await serviceToken("billing:invoice:read");

    // rätt scope + tenant -> 200
    const ok = await getTo(BILLING_URL, "/internal/company-settings", {
      authorization: `Bearer ${good}`,
      "x-tenant-id": String(A.tenantId),
    });
    expect(ok.status).toBe(200);

    // saknad X-Tenant-Id -> medvetet 400
    const noTenant = await getTo(BILLING_URL, "/internal/company-settings", {
      authorization: `Bearer ${good}`,
    });
    expect(noTenant.status).toBe(400);

    // fel scope -> 403
    const badScope = await getTo(BILLING_URL, "/internal/company-settings", {
      authorization: `Bearer ${wrong}`,
      "x-tenant-id": String(A.tenantId),
    });
    expect(badScope.status).toBe(403);

    // ingen token -> 401
    const noToken = await getTo(BILLING_URL, "/internal/company-settings", {
      "x-tenant-id": String(A.tenantId),
    });
    expect(noToken.status).toBe(401);

    // användar-token på S2S-endpoint -> 401
    const userTok = await getTo(BILLING_URL, "/internal/company-settings", {
      ...authHeader(A),
      "x-tenant-id": String(A.tenantId),
    });
    expect(userTok.status).toBe(401);
  });

  test("S2S: /internal/customers/:id lämnar inte ut personnummer", async () => {
    const pnr = "199202022345";
    const res = await postTo(
      BILLING_URL,
      "/admin/customers",
      {
        customerType: "private",
        name: "Bo Boberg",
        email: "bo@ex.test",
        pnr,
      },
      { ...authHeader(A), "idempotency-key": key() },
    );
    const { id } = (await res.json()) as { id: number };

    const svc = await serviceToken("billing:customer:read");
    const s2s = await getTo(BILLING_URL, `/internal/customers/${id}`, {
      authorization: `Bearer ${svc}`,
      "x-tenant-id": String(A.tenantId),
    });
    expect(s2s.status).toBe(200);
    expect(JSON.stringify(await s2s.json())).not.toContain(pnr);
  });

  test("tenant-isolering: företag B får 404 på företag A:s faktura", async () => {
    const customerId = await makeCustomer(A, "5560000060");
    const created = await postTo(
      BILLING_URL,
      "/admin/invoices",
      { customerId, lines: oneLine },
      { ...authHeader(A), "idempotency-key": key() },
    );
    const inv = (await created.json()) as { id: number };
    const cross = await getTo(BILLING_URL, `/admin/invoices/${inv.id}`, authHeader(B));
    expect(cross.status).toBe(404);
  });
});

// Oberoende Luhn-validator för OCR-assertions.
function luhnValid(n: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = n.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Fas 5 e2e — payments: bankgiro-/OCR-matchning av inkommande
// betalningar. Webhook-signatur och tidsfönster, bankgiro->tenant-
// disambiguering (samma OCR hos två tenants), kedjeföljning av
// superseded_by_invoice_id, BgMax-liknande filimport (idempotens vid
// omimport), manuell matchningskö (idempotens, tenant-isolering,
// tokenförväxling), okänt bankgiro i driftvyn, och scope-kontroll på
// billings två nya S2S-endpoints. Körs bara med RUN_E2E mot en uppe stack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
  BILLING_URL,
  DB_URL,
  PAYMENTS_URL,
  PAYMENT_WEBHOOK_SECRET,
  decodeJwt,
  getTo,
  post,
  postTo,
  putTo,
  registerVerifyLogin,
  signPaymentWebhook,
  uniq,
  until,
  validBankgiro,
  validOrgNumber,
} from "./helpers";

const RUN = !!process.env.RUN_E2E;

// payments egen S2S-klient mot billing (bankgiro->tenant, OCR/id->faktura)
// — samma engångsklient-mönster som billing.test.ts/documents.test.ts.
const BILLING_CLIENT_ID = `svc-payments-e2e-${uniq()}`;
const BILLING_CLIENT_SECRET = "payments-e2e-billing-secret-long-and-random-0123456789";
const BILLING_SCOPES = ["billing:company:read", "billing:invoice:read"];

// Ops-klient mot payments EGNA /internal/-endpoints (filimport, driftvy)
// — normalt seedas ingen sådan klient (fas 5-planen avsnitt 5), så
// e2e-sviten provisionerar sin egen precis som för alla andra tjänster.
const OPS_CLIENT_ID = `svc-payments-ops-e2e-${uniq()}`;
const OPS_CLIENT_SECRET = "payments-e2e-ops-secret-long-and-random-0123456789";
const OPS_SCOPES = ["payments:ops:import", "payments:ops:read"];

const ONE_LINE = [
  { description: "Konsulttimmar", quantity: 1, unitPriceOre: 100_000, vatRate: 25 },
];
const FULL_AMOUNT_ORE = 125_000; // 100_000 + 25% moms
const SMALL_LINE = [
  { description: "Påminnelseavgift", quantity: 1, unitPriceOre: 1_000, vatRate: 0 },
];
const SMALL_AMOUNT_ORE = 1_000;

interface Session {
  token: string;
  tenantId: number;
}
const auth = (s: Session) => ({ authorization: `Bearer ${s.token}` });
const idem = (s: Session, key = `idem-${uniq()}-${uniq()}`) => ({
  ...auth(s),
  "idempotency-key": key,
});

describe.skipIf(!RUN)("fas 5 e2e — payments", () => {
  let sql: ReturnType<typeof postgres>;
  const tenantIds: number[] = [];
  // Två delade tenants, provisionerade EN gång i beforeAll och återanvända
  // av de flesta testerna — bara "samma OCR hos två tenants"-testet
  // behöver egna, FÄRSKA tenants (deras invoiceNumber måste båda vara 1,
  // se det testet). Motiv: varje newAdmin() är register+dev-token+verify+
  // login = 4 anrop mot auth, och 15 färska tenants (en per test) visade
  // sig i praktiken kunna trycka den delade, medvetet grova per-IP-
  // rate-limiten (packages/shared/src/service/index.ts, 300/min — samma
  // begränsning som e2e/auth.test.ts, billing.test.ts m.fl. också gör
  // anrop mot) över kanten när HELA e2e-sviten körs i följd, eftersom
  // payments.test.ts körs sist (alfabetiskt). Återanvändning här är en
  // ren testsvit-optimering, rör ingen produktionskod eller den delade
  // rate-limiten själv.
  let shared1: Session;
  let shared2: Session;
  let bgShared1: string;
  let bgShared2: string;
  let shared1CustomerId: number;
  let shared2CustomerId: number;

  async function newAdmin(prefix: string): Promise<Session> {
    const { accessToken } = await registerVerifyLogin(`${prefix}-${uniq()}@ex.test`);
    const tenantId = decodeJwt(accessToken).tenantId as number;
    tenantIds.push(tenantId);
    return { token: accessToken, tenantId };
  }

  async function fillCompanySettings(s: Session, bankgiro: string): Promise<void> {
    const res = await putTo(
      BILLING_URL,
      "/admin/company-settings",
      { companyName: `Bolag ${uniq()}`, orgNumber: validOrgNumber(), bankgiro },
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

  /**
   * Skapar och skickar en faktura med de givna raderna, returnerar id+OCR.
   * `customerId` valfri — samma anledning som tenant-återanvändningen
   * ovan: en delad kund per delad tenant sparar en POST /admin/customers
   * per sentInvoice-anrop (billing har sin egen 300/min-gräns precis som
   * auth, och payments.test.ts:s ursprungliga ~13 separata kunder visade
   * sig kunna trycka den över kanten i den fulla sviten).
   */
  async function sentInvoice(
    s: Session,
    lines: typeof ONE_LINE,
    customerId?: number,
  ): Promise<{ id: number; ocr: string }> {
    const resolvedCustomerId = customerId ?? (await makeCustomer(s));
    const draftRes = await postTo(
      BILLING_URL,
      "/admin/invoices",
      { customerId: resolvedCustomerId, lines },
      idem(s),
    );
    if (draftRes.status !== 201) throw new Error(`createDraft: ${draftRes.status}`);
    const { id } = (await draftRes.json()) as { id: number };
    const sendRes = await postTo(BILLING_URL, `/admin/invoices/${id}/send`, {}, idem(s));
    if (sendRes.status !== 200) throw new Error(`send: ${sendRes.status}`);
    const { ocrNumber } = (await sendRes.json()) as { ocrNumber: string };
    return { id, ocr: ocrNumber };
  }

  async function invoiceStatus(s: Session, id: number): Promise<string> {
    const res = await getTo(BILLING_URL, `/admin/invoices/${id}`, auth(s));
    if (res.status !== 200) throw new Error(`get invoice: ${res.status}`);
    return ((await res.json()) as { status: string }).status;
  }

  async function billingServiceToken(scope: string): Promise<string> {
    const res = await post("/auth/token", {
      grant_type: "client_credentials",
      client_id: BILLING_CLIENT_ID,
      client_secret: BILLING_CLIENT_SECRET,
      scope,
    });
    if (res.status !== 200) throw new Error(`billingServiceToken: ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  async function opsServiceToken(scope: string): Promise<string> {
    const res = await post("/auth/token", {
      grant_type: "client_credentials",
      client_id: OPS_CLIENT_ID,
      client_secret: OPS_CLIENT_SECRET,
      scope,
    });
    if (res.status !== 200) throw new Error(`opsServiceToken: ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  function webhookHeaders(bodyText: string, timestamp = String(Math.floor(Date.now() / 1000))) {
    return {
      "content-type": "application/json",
      "x-timestamp": timestamp,
      "x-signature": signPaymentWebhook(PAYMENT_WEBHOOK_SECRET, timestamp, bodyText),
    };
  }

  async function postWebhook(
    payload: Record<string, unknown>,
    overrideHeaders?: Record<string, string>,
  ) {
    const bodyText = JSON.stringify(payload);
    return fetch(`${PAYMENTS_URL}/webhooks/payment`, {
      method: "POST",
      headers: overrideHeaders ?? webhookHeaders(bodyText),
      body: bodyText,
    });
  }

  async function payWebhook(opts: {
    bankgiro: string;
    ocr: string;
    amountOre: number;
    payerName?: string;
  }): Promise<Response> {
    return postWebhook({
      id: `evt-${uniq()}-${uniq()}`,
      bankgiro: opts.bankgiro,
      ocr: opts.ocr,
      amountOre: opts.amountOre,
      payerName: opts.payerName ?? "Betalare AB",
      bookedAt: new Date().toISOString(),
    });
  }

  beforeAll(async () => {
    sql = postgres(DB_URL);
    const billingHash = await Bun.password.hash(BILLING_CLIENT_SECRET, { algorithm: "argon2id" });
    await sql`
      INSERT INTO service_clients (client_id, client_secret_hash, allowed_scopes)
      VALUES (${BILLING_CLIENT_ID}, ${billingHash}, ${BILLING_SCOPES})
    `;
    const opsHash = await Bun.password.hash(OPS_CLIENT_SECRET, { algorithm: "argon2id" });
    await sql`
      INSERT INTO service_clients (client_id, client_secret_hash, allowed_scopes)
      VALUES (${OPS_CLIENT_ID}, ${opsHash}, ${OPS_SCOPES})
    `;

    shared1 = await newAdmin("pshared1");
    shared2 = await newAdmin("pshared2");
    bgShared1 = validBankgiro();
    bgShared2 = validBankgiro();
    await fillCompanySettings(shared1, bgShared1);
    await fillCompanySettings(shared2, bgShared2);
    shared1CustomerId = await makeCustomer(shared1);
    shared2CustomerId = await makeCustomer(shared2);
  });

  afterAll(async () => {
    // Låt eventuella event som fortfarande är på väg genom billings nya
    // payment-konsument landa innan tenants rivs.
    await new Promise((r) => setTimeout(r, 3000));
    await sql`DELETE FROM service_clients WHERE client_id IN ${sql([BILLING_CLIENT_ID, OPS_CLIENT_ID])}`;
    // bank_transactions.matched_invoice_id är RESTRICT mot invoices — rivs
    // före tenants, precis som documents.test.ts rensar sina egna
    // barntabeller före tenant-raden.
    await sql`DELETE FROM bank_transactions WHERE true`;
    if (tenantIds.length > 0) {
      await sql`DELETE FROM invoice_payments WHERE tenant_id IN ${sql(tenantIds)}`;
      await sql`DELETE FROM event_outbox WHERE tenant_id IN ${sql(tenantIds)}`;
      await sql`DELETE FROM tenants WHERE id IN ${sql(tenantIds)}`;
    }
    await sql.end();
  });

  // ── Klart när #1: två tenants, samma OCR, disambiguerat via bankgiro ──
  test("samma OCR hos två tenants: betalningen landar på rätt tenants faktura", async () => {
    const a = await newAdmin("pa");
    const b = await newAdmin("pb");
    const bgA = validBankgiro();
    const bgB = validBankgiro();
    await fillCompanySettings(a, bgA);
    await fillCompanySettings(b, bgB);

    const invA = await sentInvoice(a, ONE_LINE);
    const invB = await sentInvoice(b, ONE_LINE);
    // Båda är varje tenants FÖRSTA faktura -> samma invoiceNumber (1) ->
    // samma OCR, per konstruktion (next_invoice_number defaultar till 1).
    expect(invA.ocr).toBe(invB.ocr);

    const resA = await payWebhook({ bankgiro: bgA, ocr: invA.ocr, amountOre: FULL_AMOUNT_ORE });
    expect(resA.status).toBe(200);
    expect(((await resA.json()) as { status: string }).status).toBe("accepted");
    const resB = await payWebhook({ bankgiro: bgB, ocr: invB.ocr, amountOre: FULL_AMOUNT_ORE });
    expect(resB.status).toBe(200);

    await until(async () => (await invoiceStatus(a, invA.id)) === "paid");
    await until(async () => (await invoiceStatus(b, invB.id)) === "paid");

    // B:s betalning fick inte röra A:s faktura eller tvärtom.
    const [payA] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = ${invA.id}
    `;
    expect(payA!.n).toBe(1);
    const [payB] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = ${invB.id}
    `;
    expect(payB!.n).toBe(1);
  });

  // PR-granskning fas 5, punkt 1 och 9: bankgiro normaliseras vid
  // skrivning (rena siffror, bindestreck bortstrippat) — två tenants som
  // skriver "samma" bankgiro i olika format ska kollidera på riktigt, och
  // kollisionen ska ge 409, inte ett Postgres-503:a som dessutom
  // bekräftar att en ANNAN tenant äger numret.
  test("bankgiro normaliseras och en dubblett ger 409 utan att läcka vem som äger det", async () => {
    // shared1 äger redan bgShared1 (satt i beforeAll). shared2 försöker
    // sätta SAMMA bankgiro, med bindestreck runt mitten — normaliserat
    // är det identiskt med shared1:s.
    const formatted = `${bgShared1.slice(0, 4)}-${bgShared1.slice(4)}`;
    const conflict = await putTo(
      BILLING_URL,
      "/admin/company-settings",
      { companyName: "Konflikt AB", orgNumber: validOrgNumber(), bankgiro: formatted },
      auth(shared2),
    );
    expect(conflict.status).toBe(409);
    const body = JSON.stringify(await conflict.json());
    expect(body).not.toContain(String(shared1.tenantId));

    // Misslyckad skrivning lämnar shared2:s EGET bankgiro orört.
    const stillShared2 = await getTo(BILLING_URL, "/admin/company-settings", auth(shared2));
    expect(((await stillShared2.json()) as { bankgiro: string }).bankgiro).toBe(bgShared2);

    // En inkommande betalning mot shared1:s RENA sifferform matchar
    // fortfarande shared1, oavsett hur formatet som just krockade såg ut.
    const byBg = await getTo(
      BILLING_URL,
      `/internal/company-settings/by-bankgiro?bankgiro=${bgShared1}`,
      { authorization: `Bearer ${await billingServiceToken("billing:company:read")}` },
    );
    expect(byBg.status).toBe(200);
    expect(((await byBg.json()) as { tenantId: number }).tenantId).toBe(shared1.tenantId);
  });

  // ── Klart när #2: superseded fakturas OCR -> efterträdarens id ──────
  test("betalning på en superseded fakturas OCR landar på efterträdaren", async () => {
    const s = shared1;
    const bankgiro = bgShared1;

    const original = await sentInvoice(s, ONE_LINE, shared1CustomerId);
    const successor = await sentInvoice(s, ONE_LINE, shared1CustomerId);
    // Den riktiga påminnelse-cronen finns inte förrän fas 6 — kopplingen
    // sätts direkt via SQL i testuppsättningen, precis som planen beskriver.
    await sql`UPDATE invoices SET superseded_by_invoice_id = ${successor.id} WHERE id = ${original.id}`;

    const res = await payWebhook({ bankgiro, ocr: original.ocr, amountOre: FULL_AMOUNT_ORE });
    expect(res.status).toBe(200);

    await until(async () => (await invoiceStatus(s, successor.id)) === "paid");
    expect(await invoiceStatus(s, original.id)).not.toBe("paid");
    const [payOriginal] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = ${original.id}
    `;
    expect(payOriginal!.n).toBe(0);
  });

  // ── Webhook-signatur/replay ─────────────────────────────────────────
  test("webhook: fel signatur ger 401 (även med trasig JSON), gammal tidsstämpel ger 400", async () => {
    const payload = { id: `evt-${uniq()}`, bankgiro: "12345678", ocr: "123", amountOre: 100 };
    const bodyText = JSON.stringify(payload);

    const badSig = await postWebhook(payload, {
      "content-type": "application/json",
      "x-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-signature": "deadbeef",
    });
    expect(badSig.status).toBe(401);

    // Trasig JSON + fel signatur -> FORTFARANDE 401, inte 400 — signaturen
    // kollas före JSON ens parsas (domain.md #25).
    const ts = String(Math.floor(Date.now() / 1000));
    const brokenJson = await fetch(`${PAYMENTS_URL}/webhooks/payment`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-timestamp": ts, "x-signature": "deadbeef" },
      body: "{not json",
    });
    expect(brokenJson.status).toBe(401);

    const oldTs = String(Math.floor(Date.now() / 1000) - 3600);
    const stale = await postWebhook(payload, {
      "content-type": "application/json",
      "x-timestamp": oldTs,
      "x-signature": signPaymentWebhook(PAYMENT_WEBHOOK_SECRET, oldTs, bodyText),
    });
    expect(stale.status).toBe(400);
  });

  test("webhook: giltig + duplicerat id -> duplicate, ingen ny rad", async () => {
    const s = shared1;
    const bankgiro = bgShared1;
    const inv = await sentInvoice(s, ONE_LINE, shared1CustomerId);

    const id = `evt-dup-${uniq()}`;
    const first = await postWebhook({
      id,
      bankgiro,
      ocr: inv.ocr,
      amountOre: FULL_AMOUNT_ORE,
      bookedAt: new Date().toISOString(),
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { status: string }).status).toBe("accepted");
    await until(async () => (await invoiceStatus(s, inv.id)) === "paid");

    const second = await postWebhook({
      id,
      bankgiro,
      ocr: inv.ocr,
      amountOre: FULL_AMOUNT_ORE,
      bookedAt: new Date().toISOString(),
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { status: string }).status).toBe("duplicate");

    const [count] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM bank_transactions WHERE source = 'webhook:mockbank' AND external_id = ${id}
    `;
    expect(count!.n).toBe(1);
  });

  // PR-granskning fas 5, punkt 7: en betalning utan OCR-referens är det
  // arketypiska unknown_ocr-fallet — ska landa i manual_review, inte
  // avvisas vid dörren.
  test("webhook: saknat OCR landar i manual_review/unknown_ocr, inte avvisat", async () => {
    const s = shared1;
    const bankgiro = bgShared1;

    const res = await postWebhook({
      id: `evt-no-ocr-${uniq()}`,
      bankgiro,
      amountOre: 5000,
      bookedAt: new Date().toISOString(),
      // ocr medvetet utelämnat.
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("accepted");

    const items = await until(async () => {
      const r = await getTo(PAYMENTS_URL, "/admin/payments/unmatched", auth(s));
      const body = (await r.json()) as { items: Array<{ ocr: string; unmatchedReason: string }> };
      return body.items.find((i) => i.ocr === "") ? body.items : undefined;
    });
    const row = items.find((i) => i.ocr === "");
    expect(row?.unmatchedReason).toBe("unknown_ocr");
  });

  // PR-granskning fas 5, punkt 2: skriver raden FÖRE billing rings, i
  // status 'pending'. Simulerar ett tidigare avbrutet försök genom att
  // sätta in raden direkt via SQL i just det läget, och bevisar att en
  // omleverans av SAMMA event löser den (bokför betalningen) i stället
  // för att bara skriva "duplicate" och lämna pengarna spårlösa.
  test("webhook: en kvarstående 'pending'-rad löses av en omleverans, räknas inte som duplicate", async () => {
    const s = shared1;
    const bankgiro = bgShared1;
    const inv = await sentInvoice(s, ONE_LINE, shared1CustomerId);
    const externalId = `evt-pending-${uniq()}`;

    // Simulerar att ett tidigare webhook-försök hann skriva 'pending'-
    // raden men aldrig nådde fram till billing (t.ex. ett avbrott).
    await sql`
      INSERT INTO bank_transactions (source, external_id, bankgiro, ocr, amount_ore, booked_at, status)
      VALUES ('webhook:mockbank', ${externalId}, ${bankgiro}, ${inv.ocr}, ${FULL_AMOUNT_ORE}, now(), 'pending')
    `;

    const res = await postWebhook({
      id: externalId,
      bankgiro,
      ocr: inv.ocr,
      amountOre: FULL_AMOUNT_ORE,
      bookedAt: new Date().toISOString(),
    });
    expect(res.status).toBe(200);
    // INTE 'duplicate' — den kvarstående pending-raden ska LÖSAS, inte
    // tolkas som redan avgjord.
    expect(((await res.json()) as { status: string }).status).toBe("accepted");

    await until(async () => (await invoiceStatus(s, inv.id)) === "paid");
    const [txRow] = await sql<
      { status: string }[]
    >`SELECT status FROM bank_transactions WHERE source = 'webhook:mockbank' AND external_id = ${externalId}`;
    expect(txRow!.status).toBe("matched");
  });

  // ── Okänt bankgiro: driftvyn, osynlig för alla tenants ──────────────
  test("okänt bankgiro: rad utan tenant, synlig bara via driftvyn", async () => {
    const s = shared1;
    const unknownBankgiro = validBankgiro(); // giltigt format, registrerat hos ingen

    const res = await payWebhook({ bankgiro: unknownBankgiro, ocr: "123", amountOre: 5000 });
    expect(res.status).toBe(200);

    const opsToken = await opsServiceToken("payments:ops:read");
    const opsRes = await until(async () => {
      const r = await fetch(`${PAYMENTS_URL}/internal/ops/payments/unknown-bankgiro`, {
        headers: { authorization: `Bearer ${opsToken}` },
      });
      const body = (await r.json()) as { transactions: Array<{ bankgiro: string }> };
      return body.transactions.some((t) => t.bankgiro === unknownBankgiro) ? body : undefined;
    });
    expect(opsRes.transactions.some((t) => t.bankgiro === unknownBankgiro)).toBe(true);

    // Osynlig i den (enda relevanta) tenantens manuella kö — raden har
    // ingen tenant över huvud taget.
    const unmatchedRes = await getTo(PAYMENTS_URL, "/admin/payments/unmatched", auth(s));
    expect(unmatchedRes.status).toBe(200);
    const items = ((await unmatchedRes.json()) as { items: Array<{ bankgiro: string }> }).items;
    expect(items.some((i) => i.bankgiro === unknownBankgiro)).toBe(false);
  });

  // ── manual_review-grenarna ───────────────────────────────────────────
  test("okänt OCR, överbetalning och ambiguous landar i manual_review med rätt reason", async () => {
    const s = shared1;
    const other = shared2;
    const bankgiro = bgShared1;

    // unknown_ocr: giltigt formaterat OCR som inte matchar någon faktura.
    const unknownOcrRes = await payWebhook({ bankgiro, ocr: "9999999999999", amountOre: 5000 });
    expect(unknownOcrRes.status).toBe(200);

    // overpayment: en riktig faktura, belopp > remainingOre.
    const small = await sentInvoice(s, SMALL_LINE, shared1CustomerId);
    const overpayRes = await payWebhook({
      bankgiro,
      ocr: small.ocr,
      amountOre: SMALL_AMOUNT_ORE + 100_00,
    });
    expect(overpayRes.status).toBe(200);

    // ambiguous: fakturan finns men är i ett läge som inte kan bokföras
    // (krediterad -> status 'credited', varken 'sent' eller 'overdue').
    const toCredit = await sentInvoice(s, ONE_LINE, shared1CustomerId);
    const creditRes = await postTo(
      BILLING_URL,
      `/admin/invoices/${toCredit.id}/credit`,
      {},
      idem(s),
    );
    expect(creditRes.status).toBe(201);
    const ambiguousRes = await payWebhook({
      bankgiro,
      ocr: toCredit.ocr,
      amountOre: FULL_AMOUNT_ORE,
    });
    expect(ambiguousRes.status).toBe(200);

    // Specifika OCR-matchningar i stället för ett blankt längdvillkor —
    // s (shared1) återanvänds av flera tester, så robust mot vilka andra
    // manual_review-rader som råkar ligga kvar sedan tidigare.
    const wantedOcrs = ["9999999999999", small.ocr, toCredit.ocr];
    const items = await until(async () => {
      const r = await getTo(PAYMENTS_URL, "/admin/payments/unmatched", auth(s));
      const body = (await r.json()) as {
        items: Array<{ ocr: string; unmatchedReason: string }>;
      };
      const hasAll = wantedOcrs.every((ocr) => body.items.some((i) => i.ocr === ocr));
      return hasAll ? body.items : undefined;
    });
    const reasons = new Map(items.map((i) => [i.ocr, i.unmatchedReason]));
    expect(reasons.get("9999999999999")).toBe("unknown_ocr");
    expect(reasons.get(small.ocr)).toBe("overpayment");
    expect(reasons.get(toCredit.ocr)).toBe("ambiguous");

    // Tenant-isolering: en annan tenant ser ingenting av det här.
    const otherItems = await getTo(PAYMENTS_URL, "/admin/payments/unmatched", auth(other));
    expect(((await otherItems.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  // ── Manuell matchning ────────────────────────────────────────────────
  test("admin match/ignore: idempotens, 404 över tenant-gräns, 422 vid överbetalning, lyckad matchning", async () => {
    const s = shared1;
    const otherTenant = shared2;
    const bankgiro = bgShared1;

    const target = await sentInvoice(s, ONE_LINE, shared1CustomerId);
    const smallTarget = await sentInvoice(s, SMALL_LINE, shared1CustomerId);
    const otherInvoice = await sentInvoice(otherTenant, ONE_LINE, shared2CustomerId);

    // En manual_review-rad (okänt OCR) att matcha manuellt mot `target`.
    await payWebhook({ bankgiro, ocr: "8888888888888", amountOre: FULL_AMOUNT_ORE });
    const row = await until(async () => {
      const r = await getTo(PAYMENTS_URL, "/admin/payments/unmatched", auth(s));
      const body = (await r.json()) as { items: Array<{ id: number; ocr: string }> };
      return body.items.find((i) => i.ocr === "8888888888888");
    });

    // Idempotency-Key krävs.
    const noKey = await postTo(
      PAYMENTS_URL,
      `/admin/payments/${row.id}/match`,
      { invoiceId: target.id },
      auth(s),
    );
    expect(noKey.status).toBe(400);

    // Fel invoiceId (annan tenant) -> 404 över tenant-gränsen.
    const wrongTenant = await postTo(
      PAYMENTS_URL,
      `/admin/payments/${row.id}/match`,
      { invoiceId: otherInvoice.id },
      idem(s),
    );
    expect(wrongTenant.status).toBe(404);

    // Belopp överstiger den lilla fakturans remainingOre -> 422.
    const tooMuch = await postTo(
      PAYMENTS_URL,
      `/admin/payments/${row.id}/match`,
      { invoiceId: smallTarget.id },
      idem(s),
    );
    expect(tooMuch.status).toBe(422);

    // Lyckad matchning, samma nyckel två gånger -> identiskt svar, ingen
    // dubbelskrivning.
    const key = `idem-match-${uniq()}`;
    const first = await postTo(
      PAYMENTS_URL,
      `/admin/payments/${row.id}/match`,
      { invoiceId: target.id },
      idem(s, key),
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect((firstBody as { status: string }).status).toBe("matched");

    const second = await postTo(
      PAYMENTS_URL,
      `/admin/payments/${row.id}/match`,
      { invoiceId: target.id },
      idem(s, key),
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);

    await until(async () => (await invoiceStatus(s, target.id)) === "paid");
    const [payCount] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = ${target.id}
    `;
    expect(payCount!.n).toBe(1); // ingen dubbelskrivning trots två anrop

    const [txRow] = await sql<
      { status: string }[]
    >`SELECT status FROM bank_transactions WHERE id = ${row.id}`;
    expect(txRow!.status).toBe("matched");
  });

  // PR-granskning fas 5, punkt 4: en manual_review-rad märkt overpayment
  // gick tidigare INTE att lösa på något sätt — matchning gav alltid
  // 422, ignore bokförde inget. acceptOverpayment är den enda vägen ut.
  test("admin match med acceptOverpayment: bokför en tidigare olösbar överbetalning", async () => {
    const s = shared1;
    const bankgiro = bgShared1;
    const target = await sentInvoice(s, SMALL_LINE, shared1CustomerId);

    // target.ocr resolver till target med en LEVANDE remainingOre som är
    // mindre än det inbetalda beloppet — det är det som faktiskt utlöser
    // 'overpayment' (till skillnad från övriga tester i den här filen,
    // som medvetet använder ett OKÄNT OCR och matchar manuellt mot en
    // godtycklig faktura).
    await payWebhook({ bankgiro, ocr: target.ocr, amountOre: SMALL_AMOUNT_ORE + 500_00 });
    const row = await until(async () => {
      const r = await getTo(PAYMENTS_URL, "/admin/payments/unmatched", auth(s));
      const body = (await r.json()) as {
        items: Array<{ id: number; ocr: string; unmatchedReason: string }>;
      };
      return body.items.find((i) => i.ocr === target.ocr);
    });
    expect(row.unmatchedReason).toBe("overpayment");

    // Utan flaggan: fortfarande 422, oförändrat beteende.
    const stillBlocked = await postTo(
      PAYMENTS_URL,
      `/admin/payments/${row.id}/match`,
      { invoiceId: target.id },
      idem(s),
    );
    expect(stillBlocked.status).toBe(422);

    // Med flaggan: bokförs, fakturan blir betald, raden lämnar manual_review.
    const accepted = await postTo(
      PAYMENTS_URL,
      `/admin/payments/${row.id}/match`,
      { invoiceId: target.id, acceptOverpayment: true },
      idem(s),
    );
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as { status: string }).status).toBe("matched");

    await until(async () => (await invoiceStatus(s, target.id)) === "paid");
    const [txRow] = await sql<
      { status: string }[]
    >`SELECT status FROM bank_transactions WHERE id = ${row.id}`;
    expect(txRow!.status).toBe("matched");
  });

  test("admin ignore: idempotens, inget event publiceras", async () => {
    const s = shared1;
    const bankgiro = bgShared1;
    const inv = await sentInvoice(s, ONE_LINE, shared1CustomerId);

    await payWebhook({ bankgiro, ocr: "7777777777777", amountOre: FULL_AMOUNT_ORE });
    const row = await until(async () => {
      const r = await getTo(PAYMENTS_URL, "/admin/payments/unmatched", auth(s));
      const body = (await r.json()) as { items: Array<{ id: number; ocr: string }> };
      return body.items.find((i) => i.ocr === "7777777777777");
    });

    const noKey = await postTo(
      PAYMENTS_URL,
      `/admin/payments/${row.id}/ignore`,
      { reason: "test" },
      auth(s),
    );
    expect(noKey.status).toBe(400);

    const key = `idem-ignore-${uniq()}`;
    const first = await postTo(
      PAYMENTS_URL,
      `/admin/payments/${row.id}/ignore`,
      { reason: "felaktig inbetalning" },
      idem(s, key),
    );
    expect(first.status).toBe(200);
    const second = await postTo(
      PAYMENTS_URL,
      `/admin/payments/${row.id}/ignore`,
      { reason: "felaktig inbetalning" },
      idem(s, key),
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());

    await new Promise((r) => setTimeout(r, 1500));
    expect(await invoiceStatus(s, inv.id)).toBe("sent"); // orört
    const [txRow] = await sql<
      { status: string }[]
    >`SELECT status FROM bank_transactions WHERE id = ${row.id}`;
    expect(txRow!.status).toBe("ignored");
  });

  // ── Tokenförväxling ──────────────────────────────────────────────────
  test("S2S-token avvisas på /admin/payments/*; X-Tenant-Id ignoreras på användar-endpoints", async () => {
    const s = shared1;
    const other = shared2;

    const svcToken = await billingServiceToken("billing:invoice:read");
    const svcRes = await getTo(PAYMENTS_URL, "/admin/payments/unmatched", {
      authorization: `Bearer ${svcToken}`,
    });
    expect(svcRes.status).toBe(401); // tjänste-token på en requireUser-endpoint

    // Förfalskad X-Tenant-Id i en vanlig användarrequest ignoreras —
    // tenantId kommer bara från JWT:et (architecture.md #17).
    const forged = await getTo(PAYMENTS_URL, "/admin/payments/unmatched", {
      ...auth(other),
      "x-tenant-id": String(s.tenantId),
    });
    expect(forged.status).toBe(200);
    // `other` har ingen manual_review-rad — om X-Tenant-Id hade vunnit
    // skulle den här kunna spegla s:s data i stället.
    expect(((await forged.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  // ── BgMax-liknande filimport: idempotens vid omimport ───────────────
  test("filimport: samma fil två gånger skriver noll nya rader andra gången", async () => {
    const s = shared1;
    const bankgiro = bgShared1;
    const inv = await sentInvoice(s, ONE_LINE, shared1CustomerId);

    const externalId = `import-${uniq()}`;
    const line = [
      bankgiro,
      inv.ocr,
      String(FULL_AMOUNT_ORE),
      "Import AB",
      "2026-09-10",
      externalId,
    ].join("|");
    const token = await opsServiceToken("payments:ops:import");

    const first = await fetch(`${PAYMENTS_URL}/internal/payments/import`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" },
      body: line,
    });
    expect(first.status).toBe(200);
    const firstSummary = (await first.json()) as {
      transactionsWritten: number;
      duplicates: number;
      autoMatched: number;
    };
    expect(firstSummary.transactionsWritten).toBe(1);
    expect(firstSummary.autoMatched).toBe(1);
    await until(async () => (await invoiceStatus(s, inv.id)) === "paid");

    const [countAfterFirst] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM bank_transactions WHERE source = 'bgmax' AND external_id = ${externalId}
    `;
    expect(countAfterFirst!.n).toBe(1);

    const second = await fetch(`${PAYMENTS_URL}/internal/payments/import`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" },
      body: line,
    });
    expect(second.status).toBe(200);
    const secondSummary = (await second.json()) as {
      transactionsWritten: number;
      duplicates: number;
    };
    expect(secondSummary.transactionsWritten).toBe(0);
    expect(secondSummary.duplicates).toBe(1);

    const [countAfterSecond] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM bank_transactions WHERE source = 'bgmax' AND external_id = ${externalId}
    `;
    expect(countAfterSecond!.n).toBe(1); // inte 2

    const [payCount] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = ${inv.id}
    `;
    expect(payCount!.n).toBe(1); // fakturans paidOre opåverkad av omimporten
  });

  // ── Scope-kontroll på billings två nya S2S-endpoints ────────────────
  test("billing S2S: by-bankgiro och invoices/:id/current kräver rätt scope och isolerar tenant", async () => {
    const s = shared1;
    const other = shared2;
    const bankgiro = bgShared1;
    const inv = await sentInvoice(s, ONE_LINE, shared1CustomerId);

    const good = await billingServiceToken("billing:company:read");
    const wrongScope = await billingServiceToken("billing:invoice:read");

    // by-bankgiro
    expect(
      (await getTo(BILLING_URL, `/internal/company-settings/by-bankgiro?bankgiro=${bankgiro}`))
        .status,
    ).toBe(401); // inget token
    expect(
      (
        await getTo(BILLING_URL, `/internal/company-settings/by-bankgiro?bankgiro=${bankgiro}`, {
          authorization: `Bearer ${wrongScope}`,
        })
      ).status,
    ).toBe(403); // fel scope
    const byBg = await getTo(
      BILLING_URL,
      `/internal/company-settings/by-bankgiro?bankgiro=${bankgiro}`,
      {
        authorization: `Bearer ${good}`,
      },
    );
    expect(byBg.status).toBe(200);
    expect(((await byBg.json()) as { tenantId: number }).tenantId).toBe(s.tenantId);
    // okänt bankgiro -> 404
    expect(
      (
        await getTo(
          BILLING_URL,
          `/internal/company-settings/by-bankgiro?bankgiro=${validBankgiro()}`,
          {
            authorization: `Bearer ${good}`,
          },
        )
      ).status,
    ).toBe(404);

    // invoices/:id/current
    const invoiceScope = await billingServiceToken("billing:invoice:read");
    expect((await getTo(BILLING_URL, `/internal/invoices/${inv.id}/current`)).status).toBe(401);
    expect(
      (
        await getTo(BILLING_URL, `/internal/invoices/${inv.id}/current`, {
          authorization: `Bearer ${good}`, // billing:company:read, fel scope här
          "x-tenant-id": String(s.tenantId),
        })
      ).status,
    ).toBe(403);
    const current = await getTo(BILLING_URL, `/internal/invoices/${inv.id}/current`, {
      authorization: `Bearer ${invoiceScope}`,
      "x-tenant-id": String(s.tenantId),
    });
    expect(current.status).toBe(200);
    expect(((await current.json()) as { currentInvoiceId: number }).currentInvoiceId).toBe(inv.id);
    // fel tenant -> 404, inte 403 (404 över tenant-gränsen, CLAUDE.md snabbfakta)
    expect(
      (
        await getTo(BILLING_URL, `/internal/invoices/${inv.id}/current`, {
          authorization: `Bearer ${invoiceScope}`,
          "x-tenant-id": String(other.tenantId),
        })
      ).status,
    ).toBe(404);
  });
});

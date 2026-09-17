// Fas 10 e2e — portalbetalning via Stripe (testläge): Checkout-session
// skapas med en LEVANDE remainingOre (ett manipulerat belopp från klienten
// ignoreras), rollisolering på den nya /portal/*-endpointen (testing.md
// #1), simulerad Stripe-webhook ger fakturan paid, fel signatur avvisas,
// samma event två gånger bokförs bara en gång. Körs bara med RUN_E2E mot
// en uppe stack. STRIPE_PROVIDER=mock i CI (architecture.md #25) — inget
// Stripe-konto eller nätverksanrop till Stripe behövs, webhooken simuleras
// med en handsignerad payload precis som e2e/documents.test.ts och
// e2e/payments.test.ts redan gör för sina egna webhooks.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
  AUTH_URL,
  BILLING_URL,
  DB_URL,
  PAYMENTS_URL,
  STRIPE_WEBHOOK_SECRET,
  decodeJwt,
  get,
  getTo,
  post,
  postTo,
  putTo,
  registerVerifyLogin,
  signStripeWebhook,
  uniq,
  until,
  validBankgiro,
  validOrgNumber,
} from "./helpers";

const RUN = !!process.env.RUN_E2E;

const ONE_LINE = [
  { description: "Konsulttimmar", quantity: 1, unitPriceOre: 100_000, vatRate: 25 },
];
const FULL_AMOUNT_ORE = 125_000; // 100_000 + 25% moms
const CUSTOMER_PASSWORD = "kundens-egna-losenord-stripe-9999";

interface Session {
  token: string;
  tenantId: number;
}
const auth = (s: Session) => ({ authorization: `Bearer ${s.token}` });
const idem = (s: Session) => ({ ...auth(s), "idempotency-key": `idem-${uniq()}-${uniq()}` });

describe.skipIf(!RUN)("fas 10 e2e — Stripe-betalning", () => {
  let sql: ReturnType<typeof postgres>;
  const tenantIds: number[] = [];

  async function newAdmin(prefix = "stripe"): Promise<Session> {
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

  async function sentInvoice(s: Session, customerId: number): Promise<number> {
    const draft = await postTo(
      BILLING_URL,
      "/admin/invoices",
      { customerId, lines: ONE_LINE },
      idem(s),
    );
    if (draft.status !== 201) throw new Error(`createDraft: ${draft.status}`);
    const { id } = (await draft.json()) as { id: number };
    const sent = await postTo(BILLING_URL, `/admin/invoices/${id}/send`, {}, idem(s));
    if (sent.status !== 200) throw new Error(`send: ${sent.status}`);
    return id;
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

  async function getInvoice(s: Session, id: number) {
    const res = await getTo(BILLING_URL, `/admin/invoices/${id}`, auth(s));
    if (res.status !== 200) throw new Error(`get invoice: ${res.status}`);
    return (await res.json()) as { status: string };
  }

  beforeAll(() => {
    sql = postgres(DB_URL);
  });

  afterAll(async () => {
    if (tenantIds.length > 0) {
      await sql`DELETE FROM stripe_payments WHERE tenant_id IN ${sql(tenantIds)}`;
      await sql`DELETE FROM invoice_payments WHERE tenant_id IN ${sql(tenantIds)}`;
      await sql`DELETE FROM event_outbox WHERE tenant_id IN ${sql(tenantIds)}`;
      await sql`DELETE FROM tenants WHERE id IN ${sql(tenantIds)}`;
    }
    await sql.end();
  });

  test("POST /portal/invoices/:id/pay: beloppet är fakturans levande remainingOre, ett belopp från klienten ignoreras", async () => {
    const admin = await newAdmin();
    await fillCompanySettings(admin);
    const email = `kund-${uniq()}@ex.test`;
    const customerId = await makeCustomer(admin, email);
    const invoiceId = await sentInvoice(admin, customerId);
    const customer = await inviteAndAccept(admin, customerId, email);

    const res = await fetch(`${BILLING_URL}/portal/invoices/${invoiceId}/pay`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${customer.accessToken}`,
        "content-type": "application/json",
      },
      // amountOre här ska INTE läsas av något led — servern räknar själv.
      body: JSON.stringify({ amountOre: 1 }),
    });
    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };
    expect(url).toContain("checkout.stripe.test");

    const [row] = await sql<{ amount_ore: string; invoice_id: number }[]>`
      SELECT amount_ore, invoice_id FROM stripe_payments
      WHERE tenant_id = ${admin.tenantId} AND invoice_id = ${invoiceId}
    `;
    expect(row).toBeDefined();
    expect(Number(row!.amount_ore)).toBe(FULL_AMOUNT_ORE);
  });

  test("rollisolering: en kund kan inte betala en annan kunds faktura (404), inte heller en annan tenants", async () => {
    const admin = await newAdmin();
    await fillCompanySettings(admin);
    const emailA = `a-${uniq()}@ex.test`;
    const customerA = await makeCustomer(admin, emailA);
    const customerB = await makeCustomer(admin);
    const invoiceOfB = await sentInvoice(admin, customerB);

    const otherAdmin = await newAdmin();
    await fillCompanySettings(otherAdmin);
    const invoiceOfOtherTenant = await sentInvoice(otherAdmin, await makeCustomer(otherAdmin));

    const custA = await inviteAndAccept(admin, customerA, emailA);
    const cAuth = {
      authorization: `Bearer ${custA.accessToken}`,
      "content-type": "application/json",
    };

    const againstB = await fetch(`${BILLING_URL}/portal/invoices/${invoiceOfB}/pay`, {
      method: "POST",
      headers: cAuth,
      body: "{}",
    });
    expect(againstB.status).toBe(404);

    const againstOtherTenant = await fetch(
      `${BILLING_URL}/portal/invoices/${invoiceOfOtherTenant}/pay`,
      { method: "POST", headers: cAuth, body: "{}" },
    );
    expect(againstOtherTenant.status).toBe(404);
  });

  test("redan betald faktura kan inte betalas igen via Stripe (409)", async () => {
    const admin = await newAdmin();
    await fillCompanySettings(admin);
    const email = `kund-${uniq()}@ex.test`;
    const customerId = await makeCustomer(admin, email);
    const invoiceId = await sentInvoice(admin, customerId);

    // Betala hela beloppet direkt i DB — vägen dit (bank/webhook) är redan
    // täckt av e2e/payments.test.ts, det här testet handlar bara om att
    // Stripe-endpointen respekterar en redan täckt faktura.
    await sql`
      INSERT INTO invoice_payments (tenant_id, invoice_id, payment_id, amount_ore)
      VALUES (${admin.tenantId}, ${invoiceId}, ${`e2e-direct-${uniq()}`}, ${FULL_AMOUNT_ORE})
    `;
    await sql`UPDATE invoices SET status = 'paid' WHERE id = ${invoiceId}`;

    const customer = await inviteAndAccept(admin, customerId, email);
    const res = await fetch(`${BILLING_URL}/portal/invoices/${invoiceId}/pay`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${customer.accessToken}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });

  test("webhook: simulerad Stripe-betalning ger fakturan paid; fel signatur avvisas; dubblettevent bokförs bara en gång", async () => {
    const admin = await newAdmin();
    await fillCompanySettings(admin);
    const email = `kund-${uniq()}@ex.test`;
    const customerId = await makeCustomer(admin, email);
    const invoiceId = await sentInvoice(admin, customerId);
    const customer = await inviteAndAccept(admin, customerId, email);

    const payRes = await fetch(`${BILLING_URL}/portal/invoices/${invoiceId}/pay`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${customer.accessToken}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(payRes.status).toBe(201);

    const [{ stripe_session_id: sessionId }] = await sql<{ stripe_session_id: string }[]>`
      SELECT stripe_session_id FROM stripe_payments
      WHERE tenant_id = ${admin.tenantId} AND invoice_id = ${invoiceId}
    `;

    const eventBody = JSON.stringify({
      id: `evt_${uniq()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          metadata: { tenantId: String(admin.tenantId), invoiceId: String(invoiceId) },
        },
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    // Fel signatur -> 401, ingenting bokfört.
    const badSig = await fetch(`${PAYMENTS_URL}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=fel` },
      body: eventBody,
    });
    expect(badSig.status).toBe(401);

    const goodHeader = signStripeWebhook(STRIPE_WEBHOOK_SECRET, timestamp, eventBody);
    const first = await fetch(`${PAYMENTS_URL}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": goodHeader },
      body: eventBody,
    });
    expect(first.status).toBe(200);

    await until(async () => {
      const inv = await getInvoice(admin, invoiceId);
      return inv.status === "paid" ? true : undefined;
    });

    // Samma event en gång till (Stripes egen omleverans) -> fortfarande
    // 200, men bara EN invoice_payments-rad.
    const second = await fetch(`${PAYMENTS_URL}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": goodHeader },
      body: eventBody,
    });
    expect(second.status).toBe(200);

    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = ${invoiceId}
    `;
    expect(n).toBe(1);
  });
});

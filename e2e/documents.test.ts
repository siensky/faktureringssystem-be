// Fas 4 e2e — documents: invoice.sent -> PDF ur snapshoten i S3 + mejl i
// Mailpit + delivery_status rapporterad till billing (utan att röra
// invoices.status), webhook-signaturkontroll och tidsfönster, hård studs
// som flaggar adressen, monoton status (delivered efter bounced ignoreras),
// kreditfakturans PDF, och den signerade PDF-URL:ens tenant-isolering.
// Körs bara med RUN_E2E mot en uppe stack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
  BILLING_URL,
  DB_URL,
  DOCUMENTS_URL,
  EMAIL_WEBHOOK_SECRET,
  MAILPIT_URL,
  decodeJwt,
  getTo,
  post,
  postTo,
  putTo,
  registerVerifyLogin,
  signEmailWebhook,
  uniq,
  until,
  validBankgiro,
  validOrgNumber,
} from "./helpers";

const RUN = !!process.env.RUN_E2E;

const PDF_CLIENT_ID = `svc-documents-e2e-${uniq()}`;
const PDF_CLIENT_SECRET = "documents-e2e-secret-long-and-random-0123456789";
const PDF_SCOPE = "documents:pdf:read";

const ONE_LINE = [
  { description: "Konsulttimmar", quantity: 2, unitPriceOre: 100_000, vatRate: 25 },
];

interface Session {
  token: string;
  tenantId: number;
}
const auth = (s: Session) => ({ authorization: `Bearer ${s.token}` });
const idem = (s: Session) => ({ ...auth(s), "idempotency-key": `idem-${uniq()}-${uniq()}` });

describe.skipIf(!RUN)("fas 4 e2e — documents", () => {
  let sql: ReturnType<typeof postgres>;
  const tenantIds: number[] = [];

  async function newAdmin(): Promise<Session> {
    const { accessToken } = await registerVerifyLogin(`d-${uniq()}@ex.test`);
    const tenantId = decodeJwt(accessToken).tenantId as number;
    tenantIds.push(tenantId);
    return { token: accessToken, tenantId };
  }

  async function pdfToken(): Promise<string> {
    const res = await post("/auth/token", {
      grant_type: "client_credentials",
      client_id: PDF_CLIENT_ID,
      client_secret: PDF_CLIENT_SECRET,
      scope: PDF_SCOPE,
    });
    if (res.status !== 200) throw new Error(`pdfToken: ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  async function fillSettings(s: Session): Promise<void> {
    const res = await putTo(
      BILLING_URL,
      "/admin/company-settings",
      { companyName: `Bolag ${uniq()}`, orgNumber: validOrgNumber(), bankgiro: validBankgiro() },
      auth(s),
    );
    if (res.status !== 200) throw new Error(`settings: ${res.status}`);
  }

  async function makeCustomer(s: Session, email: string): Promise<number> {
    const res = await postTo(
      BILLING_URL,
      "/admin/customers",
      {
        customerType: "company",
        name: `Kund ${uniq()}`,
        email,
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

  async function createAndSend(s: Session, customerId: number): Promise<number> {
    const draft = await postTo(
      BILLING_URL,
      "/admin/invoices",
      { customerId, lines: ONE_LINE },
      idem(s),
    );
    if (draft.status !== 201) throw new Error(`createDraft: ${draft.status}`);
    const id = ((await draft.json()) as { id: number }).id;
    const sent = await postTo(BILLING_URL, `/admin/invoices/${id}/send`, {}, idem(s));
    if (sent.status !== 200) throw new Error(`send: ${sent.status}`);
    return id;
  }

  async function invoice(s: Session, id: number) {
    const res = await getTo(BILLING_URL, `/admin/invoices/${id}`, auth(s));
    if (res.status !== 200) throw new Error(`getInvoice ${id}: ${res.status}`);
    return (await res.json()) as { status: string; deliveryStatus: string };
  }

  async function waitForDelivery(s: Session, id: number, wanted: string): Promise<void> {
    await until(
      async () => {
        const inv = await invoice(s, id);
        // invoices.status får ALDRIG röras av ett leveransutfall (domain.md #28).
        expect(inv.status).toBe("sent");
        return inv.deliveryStatus === wanted ? true : undefined;
      },
      { timeoutMs: 45000 },
    );
  }

  interface MailpitMessage {
    ID: string;
    MessageID: string;
    Subject: string;
    To: Array<{ Address: string }>;
  }

  async function waitForMail(toAddress: string): Promise<MailpitMessage> {
    return until(
      async () => {
        const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=200`);
        if (!res.ok) return undefined;
        const body = (await res.json()) as { messages: MailpitMessage[] };
        return body.messages.find((m) => m.To?.some((t) => t.Address === toAddress));
      },
      { timeoutMs: 45000 },
    );
  }

  function webhookHeaders(bodyText: string, timestamp = String(Math.floor(Date.now() / 1000))) {
    return {
      "content-type": "application/json",
      "x-timestamp": timestamp,
      "x-signature": signEmailWebhook(EMAIL_WEBHOOK_SECRET, timestamp, bodyText),
    };
  }

  async function postWebhook(
    payload: Record<string, unknown>,
    overrideHeaders?: Record<string, string>,
  ) {
    const bodyText = JSON.stringify(payload);
    return fetch(`${DOCUMENTS_URL}/webhooks/email-status`, {
      method: "POST",
      headers: overrideHeaders ?? webhookHeaders(bodyText),
      body: bodyText,
    });
  }

  beforeAll(async () => {
    sql = postgres(DB_URL);
    const hash = await Bun.password.hash(PDF_CLIENT_SECRET, { algorithm: "argon2id" });
    await sql`
      INSERT INTO service_clients (client_id, client_secret_hash, allowed_scopes)
      VALUES (${PDF_CLIENT_ID}, ${hash}, ${[PDF_SCOPE]})
    `;
  });

  afterAll(async () => {
    // Låt eventuella event som fortfarande är på väg genom documents-
    // konsumenten landa innan tenants rivs — annars blir de kortlivade
    // zombies (som visserligen ack-släpps efter en omleverans nu).
    await new Promise((r) => setTimeout(r, 3000));
    await sql`DELETE FROM service_clients WHERE client_id = ${PDF_CLIENT_ID}`;
    if (tenantIds.length > 0) {
      await sql`DELETE FROM email_webhook_events WHERE true`;
      await sql`DELETE FROM email_outbox WHERE tenant_id IN ${sql(tenantIds)}`;
      await sql`DELETE FROM documents WHERE tenant_id IN ${sql(tenantIds)}`;
      await sql`DELETE FROM event_outbox WHERE tenant_id IN ${sql(tenantIds)}`;
      await sql`DELETE FROM tenants WHERE id IN ${sql(tenantIds)}`;
    }
    await sql.end();
  });

  test("invoice.sent → PDF i storage, mejl i Mailpit, delivery_status sent, invoice.status oförändrad", async () => {
    const s = await newAdmin();
    await fillSettings(s);
    const email = `kund-${uniq()}@ex.test`;
    const customerId = await makeCustomer(s, email);
    const id = await createAndSend(s, customerId);

    await waitForDelivery(s, id, "sent");

    // Exakt en documents-rad och en email_outbox-rad — ingen dubblett.
    const [docCount] = await sql`SELECT count(*)::int AS n FROM documents WHERE invoice_id = ${id}`;
    expect(docCount.n).toBe(1);
    const [mailCount] =
      await sql`SELECT count(*)::int AS n FROM email_outbox WHERE invoice_id = ${id}`;
    expect(mailCount.n).toBe(1);

    // PDF nåbar via den signerade URL:en.
    const token = await pdfToken();
    const urlRes = await fetch(`${DOCUMENTS_URL}/internal/documents/${id}/url`, {
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": String(s.tenantId) },
    });
    expect(urlRes.status).toBe(200);
    const { url, documentType } = (await urlRes.json()) as { url: string; documentType: string };
    expect(documentType).toBe("invoice");
    const pdf = await fetch(url);
    expect(pdf.status).toBe(200);
    const head = new Uint8Array(await pdf.arrayBuffer()).slice(0, 5);
    expect(Buffer.from(head).toString("latin1")).toBe("%PDF-");

    // Mejl med bilaga i Mailpit.
    const mail = await waitForMail(email);
    expect(mail.Subject).toContain("Faktura");
  });

  test("webhook: giltig 'delivered' flyttar delivery_status, status kvar 'sent'", async () => {
    const s = await newAdmin();
    await fillSettings(s);
    const email = `kund-${uniq()}@ex.test`;
    const id = await createAndSend(s, await makeCustomer(s, email));
    await waitForDelivery(s, id, "sent");
    const mail = await waitForMail(email);

    const res = await postWebhook({
      id: `evt-${uniq()}`,
      messageId: mail.MessageID,
      status: "delivered",
    });
    expect(res.status).toBe(200);
    await waitForDelivery(s, id, "delivered");
  });

  test("webhook: fel signatur ger 401, gammal tidsstämpel ger 400", async () => {
    const payload = { id: `evt-${uniq()}`, messageId: "x@y", status: "delivered" };
    const bodyText = JSON.stringify(payload);

    const bad = await postWebhook(payload, {
      "content-type": "application/json",
      "x-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-signature": "deadbeef",
    });
    expect(bad.status).toBe(401);

    // Signaturen är rätt FÖR den här bodyn och tidsstämpeln, men
    // tidsstämpeln ligger en timme bak — utanför ±5 min-fönstret.
    const oldTs = String(Math.floor(Date.now() / 1000) - 3600);
    const stale = await postWebhook(payload, {
      "content-type": "application/json",
      "x-timestamp": oldTs,
      "x-signature": signEmailWebhook(EMAIL_WEBHOOK_SECRET, oldTs, bodyText),
    });
    expect(stale.status).toBe(400);
  });

  test("hård studs flaggar adressen; en sen 'delivered' kan inte återuppliva den", async () => {
    const s = await newAdmin();
    await fillSettings(s);
    const email = `studs-${uniq()}@ex.test`;
    const customerId = await makeCustomer(s, email);
    const id = await createAndSend(s, customerId);
    await waitForDelivery(s, id, "sent");
    const mail = await waitForMail(email);

    const bounce = await postWebhook({
      id: `evt-${uniq()}`,
      messageId: mail.MessageID,
      status: "bounced",
      bounceType: "hard",
    });
    expect(bounce.status).toBe(200);
    await waitForDelivery(s, id, "bounced");

    const cust = await getTo(BILLING_URL, `/admin/customers/${customerId}`, auth(s));
    expect(((await cust.json()) as { isEmailValid: boolean }).isEmailValid).toBe(false);

    // Monotont: en försenad 'delivered' (nytt event-id) ska INTE vinna.
    const late = await postWebhook({
      id: `evt-${uniq()}`,
      messageId: mail.MessageID,
      status: "delivered",
    });
    expect(late.status).toBe(200);
    await new Promise((r) => setTimeout(r, 2000));
    expect((await invoice(s, id)).deliveryStatus).toBe("bounced");
  });

  test("kreditfaktura får egen PDF och eget mejl", async () => {
    const s = await newAdmin();
    await fillSettings(s);
    const email = `kredit-${uniq()}@ex.test`;
    const id = await createAndSend(s, await makeCustomer(s, email));
    await waitForDelivery(s, id, "sent");

    const credited = await postTo(BILLING_URL, `/admin/invoices/${id}/credit`, {}, idem(s));
    expect(credited.status).toBe(201);
    const creditId = ((await credited.json()) as { id: number }).id;

    await until(
      async () => {
        const inv = await invoice(s, creditId);
        return ["queued", "sent", "delivered"].includes(inv.deliveryStatus) ? true : undefined;
      },
      { timeoutMs: 45000 },
    );

    const token = await pdfToken();
    const urlRes = await fetch(`${DOCUMENTS_URL}/internal/documents/${creditId}/url`, {
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": String(s.tenantId) },
    });
    expect(urlRes.status).toBe(200);
    expect(((await urlRes.json()) as { documentType: string }).documentType).toBe("credit_note");
  });

  test("signerad PDF-URL: tenant-isolering (404), scope och token krävs", async () => {
    const a = await newAdmin();
    const b = await newAdmin();
    await fillSettings(a);
    const id = await createAndSend(a, await makeCustomer(a, `iso-${uniq()}@ex.test`));
    await waitForDelivery(a, id, "sent");

    const token = await pdfToken();

    // Företag B:s tenant mot företag A:s faktura -> 404, aldrig 403.
    const crossTenant = await fetch(`${DOCUMENTS_URL}/internal/documents/${id}/url`, {
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": String(b.tenantId) },
    });
    expect(crossTenant.status).toBe(404);

    // Inget token -> 401.
    const noToken = await fetch(`${DOCUMENTS_URL}/internal/documents/${id}/url`, {
      headers: { "x-tenant-id": String(a.tenantId) },
    });
    expect(noToken.status).toBe(401);

    // Ett användar-token (fel aud) -> 401 på en requireService-endpoint.
    const userToken = await fetch(`${DOCUMENTS_URL}/internal/documents/${id}/url`, {
      headers: { authorization: `Bearer ${a.token}`, "x-tenant-id": String(a.tenantId) },
    });
    expect(userToken.status).toBe(401);
  });
});

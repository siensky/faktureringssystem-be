// Fas 9 — kundinbjudan. Endpointen ligger i auth (den skriver auth-ägda
// tabeller, services/auth/src/billing-client.ts validerar customerId mot
// billing S2S), men nås via SAMMA nginx-origin som /admin/* — apiRequest
// bär redan admin-token dit precis som mot billing.
//
// Riktig e-postleverans av länken är en känd, dokumenterad lucka (samma
// som email_verification/password_reset — services/auth/src/auth/
// services.ts:s issueDevToken-kommentar). devInviteLink() försöker hämta
// länken via dev-endpointen och returnerar null om den är avstängd (t.ex.
// i produktion) — UI:t visar då bara att inbjudan är skapad.

import { ApiError, apiRequest } from "./client";

const PORTAL_BASE_URL = import.meta.env.VITE_PORTAL_BASE_URL ?? "http://localhost:5174";

export function inviteCustomer(customerId: number, email: string): Promise<{ status: "ok" }> {
  return apiRequest("/auth/customer-invites", { method: "POST", body: { customerId, email } });
}

export async function devInviteLink(email: string): Promise<string | null> {
  try {
    const { token } = await apiRequest<{ token: string }>(
      `/auth/dev/token?email=${encodeURIComponent(email)}&type=customer_invite`,
    );
    return `${PORTAL_BASE_URL}/accept-invite?token=${encodeURIComponent(token)}`;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

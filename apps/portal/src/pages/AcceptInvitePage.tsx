// Engångslänken från admin-inbjudan (POST /auth/customer-invites) landar
// här med ?token=. Sätter lösenordet och skickar sedan till /login precis
// som backoffice register -> verifiera -> login är tre skilda steg —
// accept-customer-invite loggar inte in automatiskt (services/auth/src/
// auth/services.ts:s acceptCustomerInvite).

import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as authApi from "../api/auth";

export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Lösenorden matchar inte");
      return;
    }
    setIsSubmitting(true);
    try {
      await authApi.acceptCustomerInvite({ token, password });
      setIsDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Något gick fel");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-cream-50 to-cream-100 px-4">
        <p className="text-ink-700">Länken saknar en giltig inbjudningskod.</p>
      </div>
    );
  }

  if (isDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-cream-50 to-cream-100 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-lg shadow-ink-900/5">
          <p className="mb-4 text-ink-700">Lösenordet är satt.</p>
          <Link
            to="/login"
            className="inline-block rounded-md bg-ink-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-ink-800"
          >
            Logga in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-cream-50 to-cream-100 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-ink-100 bg-white p-8 shadow-lg shadow-ink-900/5"
      >
        <h1 className="mb-6 text-xl font-semibold tracking-tight text-ink-900">Skapa lösenord</h1>
        {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <label className="mb-3 block text-sm font-medium text-ink-700">
          Lösenord
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-ink-100 px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-ink-400 focus:ring-2 focus:ring-ink-100"
          />
        </label>
        <label className="mb-6 block text-sm font-medium text-ink-700">
          Upprepa lösenord
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-ink-100 px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-ink-400 focus:ring-2 focus:ring-ink-100"
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-ink-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-ink-800 disabled:opacity-50"
        >
          {isSubmitting ? "Sparar…" : "Skapa lösenord"}
        </button>
      </form>
    </div>
  );
}

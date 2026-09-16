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
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-slate-700">Länken saknar en giltig inbjudningskod.</p>
      </div>
    );
  }

  if (isDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="mb-4 text-slate-700">Lösenordet är satt.</p>
          <Link
            to="/login"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Logga in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="mb-6 text-xl font-semibold">Skapa lösenord</h1>
        {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <label className="mb-3 block text-sm">
          Lösenord
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="mb-6 block text-sm">
          Upprepa lösenord
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isSubmitting ? "Sparar…" : "Skapa lösenord"}
        </button>
      </form>
    </div>
  );
}

import type { CreateCustomerInput, CustomerType } from "@faktura/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import * as customersApi from "../api/customers";
import { useOffsetList } from "../lib/useOffsetList";

const EMPTY_FORM = {
  customerType: "company" as CustomerType,
  name: "",
  email: "",
  orgNumber: "",
  pnr: "",
  addressStreet: "",
  addressZip: "",
  addressCity: "",
};

export function CustomersPage() {
  const queryClient = useQueryClient();
  const { items, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useOffsetList(
    ["customers"],
    (offset) => customersApi.listCustomers(offset),
  );

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (input: CreateCustomerInput) => customersApi.createCustomer(input, idempotencyKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setIsFormOpen(false);
      setForm(EMPTY_FORM);
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Något gick fel"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => customersApi.deleteCustomer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setDeleteError(null);
    },
    onError: (err) => setDeleteError(err instanceof Error ? err.message : "Något gick fel"),
  });

  function openForm() {
    // Idempotency-Key genereras när formuläret öppnas, inte vid submit
    // (planens idempotens-regel #3).
    setIdempotencyKey(crypto.randomUUID());
    setForm(EMPTY_FORM);
    setError(null);
    setIsFormOpen(true);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const input: CreateCustomerInput = {
      customerType: form.customerType,
      name: form.name,
      email: form.email,
      orgNumber: form.customerType === "company" ? form.orgNumber : undefined,
      pnr: form.customerType === "private" ? form.pnr : undefined,
      addressStreet: form.addressStreet || undefined,
      addressZip: form.addressZip || undefined,
      addressCity: form.addressCity || undefined,
    };
    createMutation.mutate(input);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kunder</h1>
        <button
          type="button"
          onClick={openForm}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Ny kund
        </button>
      </div>

      {deleteError && (
        <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p>
      )}

      {isFormOpen && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-white p-6"
        >
          {error && (
            <p className="col-span-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <label className="text-sm">
            Typ
            <select
              value={form.customerType}
              onChange={(e) => setForm({ ...form, customerType: e.target.value as CustomerType })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="company">Företag</option>
              <option value="private">Privatperson</option>
            </select>
          </label>
          <label className="text-sm">
            Namn
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            E-post
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          {form.customerType === "company" ? (
            <label className="text-sm">
              Organisationsnummer
              <input
                required
                value={form.orgNumber}
                onChange={(e) => setForm({ ...form, orgNumber: e.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          ) : (
            <label className="text-sm">
              Personnummer
              <input
                required
                value={form.pnr}
                onChange={(e) => setForm({ ...form, pnr: e.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          )}
          <label className="text-sm">
            Gata
            <input
              value={form.addressStreet}
              onChange={(e) => setForm({ ...form, addressStreet: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            Postnummer
            <input
              value={form.addressZip}
              onChange={(e) => setForm({ ...form, addressZip: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            Ort
            <input
              value={form.addressCity}
              onChange={(e) => setForm({ ...form, addressCity: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="col-span-2 flex gap-3">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {createMutation.isPending ? "Sparar…" : "Spara"}
            </button>
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="rounded border border-slate-300 px-4 py-2 text-sm"
            >
              Avbryt
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Namn</th>
              <th className="px-4 py-3 font-medium">Typ</th>
              <th className="px-4 py-3 font-medium">E-post</th>
              <th className="px-4 py-3 font-medium">Betalningsvillkor</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Laddar…
                </td>
              </tr>
            )}
            {items.map((customer) => (
              <tr key={customer.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">{customer.name}</td>
                <td className="px-4 py-3">
                  {customer.customerType === "company" ? "Företag" : "Privatperson"}
                  {!customer.isEmailValid && (
                    <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      ogiltig e-post
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{customer.email}</td>
                <td className="px-4 py-3">
                  {customer.paymentTermsDays != null ? `${customer.paymentTermsDays} dagar` : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/customers/${customer.id}/edit`}
                    className="mr-4 text-slate-600 underline"
                  >
                    Redigera
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Radera ${customer.name}?`)) {
                        deleteMutation.mutate(customer.id);
                      }
                    }}
                    className="text-red-600 underline"
                  >
                    Radera
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasNextPage && (
        <button
          type="button"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="mt-4 rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
        >
          {isFetchingNextPage ? "Laddar…" : "Ladda fler"}
        </button>
      )}
    </div>
  );
}

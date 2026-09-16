import type { UpdateCustomerInput } from "@faktura/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as customersApi from "../api/customers";

export function CustomerEditPage() {
  const { id } = useParams<{ id: string }>();
  const customerId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: customer, isLoading } = useQuery({
    queryKey: ["customers", customerId],
    queryFn: () => customersApi.getCustomer(customerId),
  });

  const [form, setForm] = useState({
    name: "",
    email: "",
    orgNumber: "",
    addressStreet: "",
    addressZip: "",
    addressCity: "",
    paymentTermsDays: "",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customer) return;
    setForm({
      name: customer.name,
      email: customer.email,
      orgNumber: customer.orgNumber ?? "",
      addressStreet: customer.address.street ?? "",
      addressZip: customer.address.zip ?? "",
      addressCity: customer.address.city ?? "",
      paymentTermsDays: customer.paymentTermsDays != null ? String(customer.paymentTermsDays) : "",
    });
  }, [customer]);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateCustomerInput) => customersApi.updateCustomer(customerId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      navigate("/customers");
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Något gick fel"),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    updateMutation.mutate({
      name: form.name,
      email: form.email,
      orgNumber: form.orgNumber || undefined,
      addressStreet: form.addressStreet || undefined,
      addressZip: form.addressZip || undefined,
      addressCity: form.addressCity || undefined,
      paymentTermsDays: form.paymentTermsDays ? Number(form.paymentTermsDays) : null,
    });
  }

  if (isLoading || !customer) {
    return <p className="text-slate-500">Laddar…</p>;
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Redigera kund</h1>
      <form
        onSubmit={handleSubmit}
        className="grid max-w-2xl grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-white p-6"
      >
        {error && (
          <p className="col-span-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
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
        {customer.customerType === "company" && (
          <label className="text-sm">
            Organisationsnummer
            <input
              value={form.orgNumber}
              onChange={(e) => setForm({ ...form, orgNumber: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        )}
        <label className="text-sm">
          Betalningsvillkor (dagar)
          <input
            type="number"
            min={0}
            value={form.paymentTermsDays}
            onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
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
            disabled={updateMutation.isPending}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {updateMutation.isPending ? "Sparar…" : "Spara"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/customers")}
            className="rounded border border-slate-300 px-4 py-2 text-sm"
          >
            Avbryt
          </button>
        </div>
      </form>
    </div>
  );
}

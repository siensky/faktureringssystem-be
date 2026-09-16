import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import * as paymentsApi from "../api/payments";
import { formatSEK } from "../lib/money";

export function UnmatchedPaymentsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["payments", "unmatched"],
    queryFn: paymentsApi.listUnmatched,
  });

  // En stabil Idempotency-Key per transaktion, återanvänd över omförsök
  // (t.ex. efter att "acceptera överbetalning" kryssats i) — genereras när
  // raden först visas, inte vid varje klick (planens idempotens-regel #3).
  const keysRef = useRef(new Map<number, string>());
  function keyFor(id: number): string {
    let key = keysRef.current.get(id);
    if (!key) {
      key = crypto.randomUUID();
      keysRef.current.set(id, key);
    }
    return key;
  }

  const [invoiceIdInputs, setInvoiceIdInputs] = useState<Record<number, string>>({});
  const [acceptOverpayment, setAcceptOverpayment] = useState<Record<number, boolean>>({});
  const [reasonInputs, setReasonInputs] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["payments", "unmatched"] });
  }

  const matchMutation = useMutation({
    mutationFn: (id: number) =>
      paymentsApi.matchTransaction(
        id,
        Number(invoiceIdInputs[id]),
        keyFor(id),
        acceptOverpayment[id] ?? false,
      ),
    onSuccess: (_, id) => {
      invalidate();
      setErrors((prev) => ({ ...prev, [id]: "" }));
    },
    onError: (err, id) =>
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "Något gick fel",
      })),
  });

  const ignoreMutation = useMutation({
    mutationFn: (id: number) =>
      paymentsApi.ignoreTransaction(id, reasonInputs[id] ?? "", keyFor(id)),
    onSuccess: (_, id) => {
      invalidate();
      setErrors((prev) => ({ ...prev, [id]: "" }));
    },
    onError: (err, id) =>
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "Något gick fel",
      })),
  });

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Omatchade betalningar</h1>

      <div className="space-y-4">
        {isLoading && <p className="text-slate-400">Laddar…</p>}
        {data?.items.length === 0 && <p className="text-slate-500">Inga omatchade betalningar.</p>}
        {data?.items.map((tx) => (
          <div key={tx.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <div>
                <span className="font-medium">{formatSEK(tx.amountOre / 100)}</span>
                <span className="ml-3 text-slate-500">OCR {tx.ocr}</span>
                <span className="ml-3 text-slate-500">Bankgiro {tx.bankgiro}</span>
                {tx.payerName && <span className="ml-3 text-slate-500">{tx.payerName}</span>}
              </div>
              <div className="text-slate-400">
                {tx.unmatchedReason ?? "obehandlad"} · bokförd {tx.bookedAt.slice(0, 10)}
              </div>
            </div>

            {errors[tx.id] && (
              <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
                {errors[tx.id]}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <input
                type="number"
                placeholder="Faktura-id"
                value={invoiceIdInputs[tx.id] ?? ""}
                onChange={(e) =>
                  setInvoiceIdInputs((prev) => ({ ...prev, [tx.id]: e.target.value }))
                }
                className="w-32 rounded border border-slate-300 px-2 py-1"
              />
              <label className="flex items-center gap-1 text-slate-500">
                <input
                  type="checkbox"
                  checked={acceptOverpayment[tx.id] ?? false}
                  onChange={(e) =>
                    setAcceptOverpayment((prev) => ({ ...prev, [tx.id]: e.target.checked }))
                  }
                />
                acceptera överbetalning
              </label>
              <button
                type="button"
                disabled={!invoiceIdInputs[tx.id] || matchMutation.isPending}
                onClick={() => matchMutation.mutate(tx.id)}
                className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
              >
                Matcha
              </button>

              <span className="mx-2 text-slate-300">|</span>

              <input
                type="text"
                placeholder="Anledning"
                value={reasonInputs[tx.id] ?? ""}
                onChange={(e) => setReasonInputs((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                className="w-48 rounded border border-slate-300 px-2 py-1"
              />
              <button
                type="button"
                disabled={!reasonInputs[tx.id] || ignoreMutation.isPending}
                onClick={() => ignoreMutation.mutate(tx.id)}
                className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-50"
              >
                Ignorera
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import * as invoicesApi from "../api/invoices";
import { StatusBadge } from "../components/StatusBadge";
import { toDateOnly } from "../lib/date";
import { formatSEK } from "../lib/money";

const CREDITABLE = new Set(["sent", "overdue", "paid"]);

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Idempotency-Key genereras när sidan (och därmed knapparna) öppnas, inte
  // vid klick (planens idempotens-regel #3).
  const [sendKey] = useState(() => crypto.randomUUID());
  const [creditKey] = useState(() => crypto.randomUUID());

  const { data: invoice, isLoading } = useQuery({
    queryKey: ["invoices", invoiceId],
    queryFn: () => invoicesApi.getInvoice(invoiceId),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
  }

  const sendMutation = useMutation({
    mutationFn: () => invoicesApi.sendInvoice(invoiceId, sendKey),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Något gick fel"),
  });

  const creditMutation = useMutation({
    mutationFn: () => invoicesApi.creditInvoice(invoiceId, creditKey),
    onSuccess: (creditNote) => {
      invalidate();
      navigate(`/invoices/${creditNote.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Något gick fel"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => invoicesApi.deleteInvoice(invoiceId),
    onSuccess: () => {
      invalidate();
      navigate("/invoices");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Något gick fel"),
  });

  if (isLoading || !invoice) {
    return <p className="text-slate-500">Laddar…</p>;
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {invoice.invoiceNumber ? `Faktura ${invoice.invoiceNumber}` : `Utkast #${invoice.id}`}
          </h1>
          <p className="text-sm text-slate-500">{invoice.customerName}</p>
        </div>
        <div className="flex gap-2">
          <StatusBadge value={invoice.status} />
          <StatusBadge value={invoice.deliveryStatus} />
        </div>
      </div>

      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mb-6 flex flex-wrap gap-3">
        {invoice.status === "draft" && (
          <>
            <Link
              to={`/invoices/${invoice.id}/edit`}
              className="rounded border border-slate-300 px-4 py-2 text-sm"
            >
              Redigera
            </Link>
            <button
              type="button"
              onClick={() => sendMutation.mutate()}
              disabled={sendMutation.isPending}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {sendMutation.isPending ? "Skickar…" : "Skicka"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Radera utkastet?")) deleteMutation.mutate();
              }}
              className="rounded border border-red-300 px-4 py-2 text-sm text-red-700"
            >
              Radera
            </button>
          </>
        )}
        {CREDITABLE.has(invoice.status) && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Skapa kreditfaktura för hela beloppet?")) creditMutation.mutate();
            }}
            disabled={creditMutation.isPending}
            className="rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            {creditMutation.isPending ? "Krediterar…" : "Kreditera"}
          </button>
        )}
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <div>
          <div className="text-slate-500">Fakturadatum</div>
          <div>{toDateOnly(invoice.dateIssued)}</div>
        </div>
        <div>
          <div className="text-slate-500">Förfaller</div>
          <div>{toDateOnly(invoice.dateDue)}</div>
        </div>
        <div>
          <div className="text-slate-500">OCR</div>
          <div>{invoice.ocrNumber ?? "—"}</div>
        </div>
      </div>

      <table className="mb-6 w-full rounded-lg border border-slate-200 bg-white text-sm">
        <thead className="border-b border-slate-200 text-left text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Beskrivning</th>
            <th className="px-4 py-3 font-medium">Antal</th>
            <th className="px-4 py-3 font-medium">À-pris</th>
            <th className="px-4 py-3 font-medium">Moms</th>
            <th className="px-4 py-3 text-right font-medium">Belopp</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.position} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-3">{line.description}</td>
              <td className="px-4 py-3">
                {line.quantity} {line.unit}
              </td>
              <td className="px-4 py-3">{formatSEK(line.unitPrice)}</td>
              <td className="px-4 py-3">{line.vatRate}%</td>
              <td className="px-4 py-3 text-right">{formatSEK(line.lineInclVat)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end">
        <div className="w-64 text-sm">
          <div className="flex justify-between py-1 text-slate-500">
            <span>Summa exkl. moms</span>
            <span>{formatSEK(invoice.totalExclVat)}</span>
          </div>
          <div className="flex justify-between py-1 text-slate-500">
            <span>Moms</span>
            <span>{formatSEK(invoice.totalVat)}</span>
          </div>
          <div className="flex justify-between py-1 font-medium">
            <span>Totalt</span>
            <span>{formatSEK(invoice.totalInclVat)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-slate-200 py-1 text-slate-500">
            <span>Betalt</span>
            <span>{formatSEK(invoice.paid)}</span>
          </div>
          <div className="flex justify-between py-1 font-medium">
            <span>Återstår</span>
            <span>{formatSEK(invoice.remaining)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

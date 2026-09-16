import type { InvoiceStatus } from "@faktura/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import * as invoicesApi from "../api/invoices";
import { StatusBadge } from "../components/StatusBadge";
import { toDateOnly } from "../lib/date";
import { formatSEK } from "../lib/money";

const STATUSES: InvoiceStatus[] = [
  "draft",
  "sent",
  "paid",
  "overdue",
  "credited",
  "superseded",
  "settled",
];

export function InvoicesPage() {
  const [status, setStatus] = useState<InvoiceStatus | "">("");

  const { data, isLoading } = useQuery({
    queryKey: ["invoices", status],
    queryFn: () => invoicesApi.listInvoices(status || undefined),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Fakturor</h1>
        <div className="flex items-center gap-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as InvoiceStatus | "")}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Alla statusar</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Link
            to="/invoices/new"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Ny faktura
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Fakturanr</th>
              <th className="px-4 py-3 font-medium">Kund</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Leverans</th>
              <th className="px-4 py-3 font-medium">Förfaller</th>
              <th className="px-4 py-3 text-right font-medium">Belopp</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Laddar…
                </td>
              </tr>
            )}
            {data?.items.map((invoice) => (
              <tr key={invoice.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">
                  <Link to={`/invoices/${invoice.id}`} className="text-slate-900 underline">
                    {invoice.invoiceNumber ?? `utkast #${invoice.id}`}
                  </Link>
                </td>
                <td className="px-4 py-3">{invoice.customerName}</td>
                <td className="px-4 py-3">
                  <StatusBadge value={invoice.status} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge value={invoice.deliveryStatus} />
                </td>
                <td className="px-4 py-3">{toDateOnly(invoice.dateDue)}</td>
                <td className="px-4 py-3 text-right">{formatSEK(invoice.totalInclVat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

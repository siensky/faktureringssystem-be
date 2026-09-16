import type { DeliveryStatus } from "@faktura/contracts";
import { useState } from "react";
import { Link } from "react-router-dom";
import * as invoicesApi from "../api/invoices";
import { StatusBadge } from "../components/StatusBadge";
import { formatSEK } from "../lib/money";
import { useOffsetList } from "../lib/useOffsetList";

const STATUSES: DeliveryStatus[] = ["none", "queued", "sent", "delivered", "bounced", "failed"];

export function DeliveriesPage() {
  const [status, setStatus] = useState<DeliveryStatus | "">("");

  const { items, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useOffsetList(
    ["deliveries", status],
    (offset) => invoicesApi.listDeliveries(status || undefined, offset),
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Leveranser</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as DeliveryStatus | "")}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Alla leveransstatusar</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Fakturanr</th>
              <th className="px-4 py-3 font-medium">Kund</th>
              <th className="px-4 py-3 font-medium">Bokföringsstatus</th>
              <th className="px-4 py-3 font-medium">Leveransstatus</th>
              <th className="px-4 py-3 text-right font-medium">Belopp</th>
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
            {items.map((invoice) => (
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
                <td className="px-4 py-3 text-right">{formatSEK(invoice.totalInclVat)}</td>
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

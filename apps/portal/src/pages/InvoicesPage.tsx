import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import * as invoicesApi from "../api/invoices";
import { StatusBadge } from "../components/StatusBadge";
import { toDateOnly } from "../lib/date";
import { formatSEK } from "../lib/money";

export function InvoicesPage() {
  const { data: summary } = useQuery({
    queryKey: ["account-summary"],
    queryFn: invoicesApi.getAccountSummary,
  });
  const { data: invoices, isLoading } = useQuery({
    queryKey: ["invoices"],
    queryFn: invoicesApi.listInvoices,
  });

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Mina fakturor</h1>

      {summary && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Utestående skuld</div>
          <div className="text-2xl font-semibold">{formatSEK(summary.outstanding)}</div>
          <div className="text-sm text-slate-500">
            {summary.outstandingInvoiceCount === 1
              ? "1 obetald faktura"
              : `${summary.outstandingInvoiceCount} obetalda fakturor`}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Fakturanr</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Förfaller</th>
              <th className="px-4 py-3 text-right font-medium">Belopp</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Laddar…
                </td>
              </tr>
            )}
            {!isLoading && invoices?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Inga fakturor än.
                </td>
              </tr>
            )}
            {invoices?.map((invoice) => (
              <tr key={invoice.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">
                  <Link to={`/invoices/${invoice.id}`} className="text-slate-900 underline">
                    {invoice.invoiceNumber}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge value={invoice.status} />
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

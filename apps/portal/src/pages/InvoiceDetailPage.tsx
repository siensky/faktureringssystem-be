import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import * as invoicesApi from "../api/invoices";
import { StatusBadge } from "../components/StatusBadge";
import { toDateOnly } from "../lib/date";
import { formatSEK } from "../lib/money";

const INVOICE_TYPE_LABELS: Record<string, string> = {
  credit_note: "Kreditfaktura",
  reminder: "Påminnelse",
};

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = Number(id);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isOpeningPdf, setIsOpeningPdf] = useState(false);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ["invoices", invoiceId],
    queryFn: () => invoicesApi.getInvoice(invoiceId),
  });

  // Ingen länk renderas i förväg — en signerad URL är en bärartoken
  // (domain.md #19) och hämtas färsk först när kunden faktiskt klickar.
  async function openPdf() {
    setPdfError(null);
    setIsOpeningPdf(true);
    try {
      const { url } = await invoicesApi.getInvoicePdfUrl(invoiceId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setPdfError(
        err instanceof ApiError && err.status === 404
          ? "PDF:en är inte klar än."
          : "Kunde inte hämta PDF:en.",
      );
    } finally {
      setIsOpeningPdf(false);
    }
  }

  if (isLoading || !invoice) {
    return <p className="text-slate-500">Laddar…</p>;
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            Faktura {invoice.invoiceNumber}
            {INVOICE_TYPE_LABELS[invoice.invoiceType] && (
              <span className="ml-2 text-base font-normal text-slate-500">
                ({INVOICE_TYPE_LABELS[invoice.invoiceType]})
              </span>
            )}
          </h1>
        </div>
        <div className="flex gap-2">
          <StatusBadge value={invoice.status} />
        </div>
      </div>

      {pdfError && (
        <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{pdfError}</p>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => void openPdf()}
          disabled={isOpeningPdf}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isOpeningPdf ? "Öppnar…" : "Öppna PDF"}
        </button>
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

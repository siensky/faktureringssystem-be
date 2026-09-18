import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import * as invoicesApi from "../api/invoices";
import { StatusBadge } from "../components/StatusBadge";
import { toDateOnly } from "../lib/date";
import { formatSEK } from "../lib/money";

const INVOICE_TYPE_LABELS: Record<string, string> = {
  credit_note: "Kreditfaktura",
  reminder: "Påminnelse",
};

const PAYABLE_STATUSES = new Set(["sent", "overdue"]);
// Kodgranskning fas 10, fynd 2: utan en bortre gräns pollar sidan i all
// oändlighet om webhooken av någon anledning aldrig kommer fram (fel
// konfigurerad endpoint, saknad webhook-registrering hos Stripe, ...).
const POLL_TIMEOUT_MS = 60_000;

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = Number(id);
  const [searchParams] = useSearchParams();
  const paymentParam = searchParams.get("payment");
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isOpeningPdf, setIsOpeningPdf] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [isStartingPayment, setIsStartingPayment] = useState(false);

  // Satt EN gång, lazy, första gången sidan renderas med ?payment=success
  // — inte i en effekt, så det första pollningsvarvet inte missar en
  // tick (samma "lazy ref-init under rendering"-mönster React själv
  // dokumenterar).
  const pollStartedAt = useRef<number | null>(null);
  if (paymentParam === "success" && pollStartedAt.current === null) {
    pollStartedAt.current = Date.now();
  }
  const hasTimedOut = () =>
    pollStartedAt.current !== null && Date.now() - pollStartedAt.current > POLL_TIMEOUT_MS;

  // Betalstatus kommer ALLTID från Stripes webhook, aldrig från att kunden
  // landar tillbaka här (domain.md #26) — "success" bevisar ingenting i
  // sig. Så länge fakturan ännu inte syns som betald pollar vi kort medan
  // webhooken hinner ikapp, i stället för att låtsas att den redan är det.
  const { data: invoice, isLoading } = useQuery({
    queryKey: ["invoices", invoiceId],
    queryFn: () => invoicesApi.getInvoice(invoiceId),
    refetchInterval: (query) =>
      paymentParam === "success" && query.state.data?.status !== "paid" && !hasTimedOut()
        ? 2000
        : false,
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

  async function startPayment() {
    setPayError(null);
    setIsStartingPayment(true);
    try {
      const { url } = await invoicesApi.payInvoice(invoiceId);
      window.location.href = url;
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Kunde inte starta betalningen.");
      setIsStartingPayment(false);
    }
  }

  if (isLoading || !invoice) {
    return <p className="text-mist-500">Laddar…</p>;
  }

  const isPayable = PAYABLE_STATUSES.has(invoice.status) && invoice.remaining > 0;

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            Faktura {invoice.invoiceNumber}
            {INVOICE_TYPE_LABELS[invoice.invoiceType] && (
              <span className="ml-2 text-base font-normal text-mist-500">
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
      {payError && (
        <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{payError}</p>
      )}
      {paymentParam === "success" && invoice.status !== "paid" && (
        <p className="mb-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {hasTimedOut()
            ? "Det tar längre tid än vanligt att bekräfta betalningen. Fakturan uppdateras automatiskt så fort den är bokförd — ladda om sidan om en stund för att kolla."
            : "Bekräftar betalningen med Stripe — det kan ta någon sekund."}
        </p>
      )}
      {paymentParam === "cancelled" && (
        <p className="mb-4 rounded bg-mist-100 px-3 py-2 text-sm text-mist-600">
          Betalningen avbröts. Ingenting har dragits.
        </p>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void openPdf()}
          disabled={isOpeningPdf}
          className="rounded-md border border-ink-100 px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-ink-300 hover:bg-ink-50 disabled:opacity-50"
        >
          {isOpeningPdf ? "Öppnar…" : "Öppna PDF"}
        </button>
        {isPayable && (
          <button
            type="button"
            onClick={() => void startPayment()}
            disabled={isStartingPayment}
            className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-ink-800 disabled:opacity-50"
          >
            {isStartingPayment ? "Startar…" : "Betala nu"}
          </button>
        )}
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4 rounded-xl border border-ink-100 bg-white p-5 text-sm shadow-sm">
        <div>
          <div className="text-mist-500">Fakturadatum</div>
          <div className="font-medium text-ink-900">{toDateOnly(invoice.dateIssued)}</div>
        </div>
        <div>
          <div className="text-mist-500">Förfaller</div>
          <div className="font-medium text-ink-900">{toDateOnly(invoice.dateDue)}</div>
        </div>
        <div>
          <div className="text-mist-500">OCR</div>
          <div className="font-medium text-ink-900">{invoice.ocrNumber ?? "—"}</div>
        </div>
      </div>

      <table className="mb-6 w-full overflow-hidden rounded-xl border border-ink-100 bg-white text-sm shadow-sm">
        <thead className="border-b border-ink-100 text-left text-mist-500">
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
            <tr key={line.position} className="border-b border-ink-50 last:border-0">
              <td className="px-4 py-3">{line.description}</td>
              <td className="px-4 py-3 text-mist-600">
                {line.quantity} {line.unit}
              </td>
              <td className="px-4 py-3 text-mist-600">{formatSEK(line.unitPrice)}</td>
              <td className="px-4 py-3 text-mist-600">{line.vatRate}%</td>
              <td className="px-4 py-3 text-right font-medium text-ink-900">
                {formatSEK(line.lineInclVat)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end">
        <div className="w-72 rounded-xl border border-ink-100 bg-white p-5 text-sm shadow-sm">
          <div className="flex justify-between py-1 text-mist-500">
            <span>Summa exkl. moms</span>
            <span>{formatSEK(invoice.totalExclVat)}</span>
          </div>
          <div className="flex justify-between py-1 text-mist-500">
            <span>Moms</span>
            <span>{formatSEK(invoice.totalVat)}</span>
          </div>
          <div className="flex justify-between py-1 font-semibold text-ink-900">
            <span>Totalt</span>
            <span>{formatSEK(invoice.totalInclVat)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-ink-100 py-1 text-mist-500">
            <span>Betalt</span>
            <span>{formatSEK(invoice.paid)}</span>
          </div>
          <div className="flex justify-between py-1 font-semibold text-ink-900">
            <span>Återstår</span>
            <span>{formatSEK(invoice.remaining)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

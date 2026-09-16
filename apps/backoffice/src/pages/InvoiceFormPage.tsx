import type { LineInputDto, VatRate } from "@faktura/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as customersApi from "../api/customers";
import * as invoicesApi from "../api/invoices";
import { toDateOnly } from "../lib/date";
import { formatSEK, kronorToOre } from "../lib/money";
import { computeLineOre } from "../lib/vat";

const VAT_RATES: VatRate[] = [0, 6, 12, 25];
// Speglar services/billing/src/invoices/schema.ts:s createInvoiceBody-gränser
// (quantity: exclusiveMinimum 0, maximum 100_000; unitPriceOre: max 100_000_000
// öre = 1 000 000 kr) — annars kan admin mata in värden som ser giltiga ut i
// live-summeringen men 400:ar på POST.
const MIN_QUANTITY = 0.001;
const MAX_QUANTITY = 100_000;
const MAX_UNIT_PRICE_KRONOR = 1_000_000;

interface LineForm {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: VatRate;
  unit: string;
}

const EMPTY_LINE: LineForm = {
  description: "",
  quantity: "1",
  unitPrice: "0",
  vatRate: 25,
  unit: "",
};

/** Speglar services/billing/src/domain/vat.ts (öre, avrundning per rad). */
function lineAmountsOre(line: LineForm) {
  const quantity = Number.parseFloat(line.quantity) || 0;
  const unitPriceOre = kronorToOre(Number.parseFloat(line.unitPrice) || 0);
  return computeLineOre(quantity, unitPriceOre, line.vatRate);
}

export function InvoiceFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined;
  const invoiceId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.listCustomers(),
  });
  const { data: existing } = useQuery({
    queryKey: ["invoices", invoiceId],
    queryFn: () => invoicesApi.getInvoice(invoiceId),
    enabled: isEdit,
  });

  const [customerId, setCustomerId] = useState<number | "">("");
  const [dateIssued, setDateIssued] = useState("");
  const [dateDue, setDateDue] = useState("");
  const [lines, setLines] = useState<LineForm[]>([EMPTY_LINE]);
  const [error, setError] = useState<string | null>(null);
  // Idempotency-Key genereras när formuläret öppnas, inte vid submit
  // (planens idempotens-regel #3) — sidladdning räknas som "öppnas".
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!existing) return;
    setCustomerId(existing.customerId);
    setDateIssued(toDateOnly(existing.dateIssued));
    setDateDue(toDateOnly(existing.dateDue));
    setLines(
      existing.lines.map((line) => ({
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
        vatRate: line.vatRate as VatRate,
        unit: line.unit,
      })),
    );
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const lineInputs: LineInputDto[] = lines.map((line) => ({
        description: line.description,
        quantity: Number.parseFloat(line.quantity) || 0,
        unitPriceOre: kronorToOre(Number.parseFloat(line.unitPrice) || 0),
        vatRate: line.vatRate,
        unit: line.unit || undefined,
      }));
      if (isEdit) {
        return invoicesApi.updateInvoice(invoiceId, {
          dateIssued: dateIssued || undefined,
          dateDue: dateDue || undefined,
          lines: lineInputs,
        });
      }
      if (customerId === "") throw new Error("Välj en kund");
      return invoicesApi.createInvoice(
        {
          customerId,
          dateIssued: dateIssued || undefined,
          dateDue: dateDue || undefined,
          lines: lineInputs,
        },
        idempotencyKey,
      );
    },
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      navigate(`/invoices/${invoice.id}`);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Något gick fel"),
  });

  function updateLine(index: number, patch: Partial<LineForm>) {
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines([...lines, EMPTY_LINE]);
  }

  function removeLine(index: number) {
    setLines(lines.filter((_, i) => i !== index));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate();
  }

  // Summeras i öre (heltal) — precis som backend — och konverteras till
  // kronor bara för visning, sist. Att summera redan öre-till-kronor-
  // konverterade flyttal här skulle kunna introducera ny avrundningsdrift.
  const totalsOre = lines.reduce(
    (acc, line) => {
      const ore = lineAmountsOre(line);
      return {
        exclVatOre: acc.exclVatOre + ore.lineExclVatOre,
        vatOre: acc.vatOre + ore.lineVatOre,
        inclVatOre: acc.inclVatOre + ore.lineInclVatOre,
      };
    },
    { exclVatOre: 0, vatOre: 0, inclVatOre: 0 },
  );

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">{isEdit ? "Redigera faktura" : "Ny faktura"}</h1>
      <form
        onSubmit={handleSubmit}
        className="max-w-4xl rounded-lg border border-slate-200 bg-white p-6"
      >
        {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mb-6 grid grid-cols-3 gap-4">
          <label className="text-sm">
            Kund
            <select
              required
              disabled={isEdit}
              value={customerId}
              onChange={(e) => setCustomerId(Number(e.target.value))}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="" disabled>
                Välj kund…
              </option>
              {customers?.items.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Fakturadatum
            <input
              type="date"
              value={dateIssued}
              onChange={(e) => setDateIssued(e.target.value)}
              placeholder="idag"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            Förfallodatum
            <input
              type="date"
              value={dateDue}
              onChange={(e) => setDateDue(e.target.value)}
              placeholder="kundens betalningsvillkor"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <table className="mb-4 w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="pb-2 font-medium">Beskrivning</th>
              <th className="pb-2 font-medium">Antal</th>
              <th className="pb-2 font-medium">Enhet</th>
              <th className="pb-2 font-medium">À-pris (kr)</th>
              <th className="pb-2 font-medium">Moms</th>
              <th className="pb-2 text-right font-medium">Belopp</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: raderna har ingen stabil id förrän de sparas
              <tr key={index} className="border-t border-slate-100">
                <td className="py-2 pr-2">
                  <input
                    required
                    value={line.description}
                    onChange={(e) => updateLine(index, { description: e.target.value })}
                    className="w-full rounded border border-slate-300 px-2 py-1"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    step="0.001"
                    min={MIN_QUANTITY}
                    max={MAX_QUANTITY}
                    required
                    value={line.quantity}
                    onChange={(e) => updateLine(index, { quantity: e.target.value })}
                    className="w-20 rounded border border-slate-300 px-2 py-1"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    value={line.unit}
                    placeholder="st"
                    onChange={(e) => updateLine(index, { unit: e.target.value })}
                    className="w-16 rounded border border-slate-300 px-2 py-1"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={MAX_UNIT_PRICE_KRONOR}
                    required
                    value={line.unitPrice}
                    onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                    className="w-28 rounded border border-slate-300 px-2 py-1"
                  />
                </td>
                <td className="py-2 pr-2">
                  <select
                    value={line.vatRate}
                    onChange={(e) =>
                      updateLine(index, { vatRate: Number(e.target.value) as VatRate })
                    }
                    className="rounded border border-slate-300 px-2 py-1"
                  >
                    {VAT_RATES.map((rate) => (
                      <option key={rate} value={rate}>
                        {rate}%
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-2 text-right">
                  {formatSEK(lineAmountsOre(line).lineInclVatOre / 100)}
                </td>
                <td className="py-2 text-right">
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      className="text-red-600"
                    >
                      Ta bort
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button type="button" onClick={addLine} className="mb-6 text-sm text-slate-600 underline">
          + Lägg till rad
        </button>

        <div className="mb-6 flex justify-end">
          <div className="w-64 text-sm">
            <div className="flex justify-between py-1 text-slate-500">
              <span>Summa exkl. moms</span>
              <span>{formatSEK(totalsOre.exclVatOre / 100)}</span>
            </div>
            <div className="flex justify-between py-1 text-slate-500">
              <span>Moms</span>
              <span>{formatSEK(totalsOre.vatOre / 100)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 py-1 font-medium">
              <span>Att betala</span>
              <span>{formatSEK(totalsOre.inclVatOre / 100)}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saveMutation.isPending ? "Sparar…" : "Spara"}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded border border-slate-300 px-4 py-2 text-sm"
          >
            Avbryt
          </button>
        </div>
      </form>
    </div>
  );
}

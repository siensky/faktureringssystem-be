import type { LineInputDto, RecurrenceInterval, VatRate } from "@faktura/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as customersApi from "../api/customers";
import * as templatesApi from "../api/invoice-templates";
import { toDateOnly } from "../lib/date";
import { formatSEK, kronorToOre } from "../lib/money";
import { computeLineOre } from "../lib/vat";

const VAT_RATES: VatRate[] = [0, 6, 12, 25];
const INTERVALS: { value: RecurrenceInterval; label: string }[] = [
  { value: "monthly", label: "Månadsvis" },
  { value: "quarterly", label: "Kvartalsvis" },
  { value: "yearly", label: "Årsvis" },
];
// Samma gränser som services/billing/src/invoices/schema.ts — se
// InvoiceFormPage.tsx:s kommentar om samma sak.
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

function lineAmountsOre(line: LineForm) {
  const quantity = Number.parseFloat(line.quantity) || 0;
  const unitPriceOre = kronorToOre(Number.parseFloat(line.unitPrice) || 0);
  return computeLineOre(quantity, unitPriceOre, line.vatRate);
}

// Morgondagen som default — assertTemplateDate (billing) avvisar ett datum
// i det förflutna, och att förvälja "idag" känns som att lova en faktura
// samma dag som mallen skapas, vilket sällan är avsikten.
function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function InvoiceTemplateFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined;
  const templateId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.listCustomers(),
  });
  const { data: existing } = useQuery({
    queryKey: ["invoice-templates", templateId],
    queryFn: () => templatesApi.getInvoiceTemplate(templateId),
    enabled: isEdit,
  });

  const [customerId, setCustomerId] = useState<number | "">("");
  const [interval, setIntervalValue] = useState<RecurrenceInterval>("monthly");
  const [nextGenerationDate, setNextGenerationDate] = useState(tomorrowIso());
  const [isActive, setIsActive] = useState(true);
  const [lines, setLines] = useState<LineForm[]>([EMPTY_LINE]);
  const [error, setError] = useState<string | null>(null);
  // Samma "genererad när formuläret öppnas"-mönster som InvoiceFormPage
  // (planens idempotens-regel #3).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!existing) return;
    setCustomerId(existing.customerId);
    setIntervalValue(existing.interval);
    setNextGenerationDate(toDateOnly(existing.nextGenerationDate));
    setIsActive(existing.isActive);
    setLines(
      existing.lines.map((line) => ({
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: String(line.unitPriceOre / 100),
        vatRate: line.vatRate as VatRate,
        unit: line.unit ?? "",
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
        return templatesApi.updateInvoiceTemplate(templateId, {
          interval,
          nextGenerationDate,
          lines: lineInputs,
          isActive,
        });
      }

      if (customerId === "") throw new Error("Välj en kund");
      return templatesApi.createInvoiceTemplate(
        { customerId, interval, nextGenerationDate, lines: lineInputs },
        idempotencyKey,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-templates"] });
      navigate("/invoice-templates");
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
      <h1 className="mb-6 text-xl font-semibold">
        {isEdit ? "Redigera återkommande faktura" : "Ny återkommande faktura"}
      </h1>
      <form
        onSubmit={handleSubmit}
        className="max-w-4xl rounded-lg border border-slate-200 bg-white p-6"
      >
        {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mb-6 grid grid-cols-2 gap-4">
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
            Intervall
            <select
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value as RecurrenceInterval)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              {INTERVALS.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Nästa fakturadatum
            <input
              type="date"
              required
              value={nextGenerationDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setNextGenerationDate(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          {isEdit && (
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Aktiv (avmarkerad = pausad, genereras inte)
            </label>
          )}
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
              <span>Belopp per faktura</span>
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

import type { RecurrenceInterval } from "@faktura/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import * as templatesApi from "../api/invoice-templates";
import { toDateOnly } from "../lib/date";
import { formatSEK } from "../lib/money";

const INTERVAL_LABELS: Record<RecurrenceInterval, string> = {
  monthly: "Månadsvis",
  quarterly: "Kvartalsvis",
  yearly: "Årsvis",
};

export function InvoiceTemplatesPage() {
  const queryClient = useQueryClient();
  const { data: templates, isLoading } = useQuery({
    queryKey: ["invoice-templates"],
    queryFn: () => templatesApi.listInvoiceTemplates(),
  });
  const [actionError, setActionError] = useState<string | null>(null);

  const toggleMutation = useMutation({
    mutationFn: (input: { id: number; isActive: boolean }) =>
      templatesApi.updateInvoiceTemplate(input.id, { isActive: input.isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-templates"] });
      setActionError(null);
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : "Något gick fel"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => templatesApi.deleteInvoiceTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-templates"] });
      setActionError(null);
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : "Något gick fel"),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Återkommande fakturor</h1>
        <Link
          to="/invoice-templates/new"
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Ny återkommande faktura
        </Link>
      </div>

      {actionError && (
        <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Kund</th>
              <th className="px-4 py-3 font-medium">Intervall</th>
              <th className="px-4 py-3 font-medium">Nästa fakturadatum</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Belopp</th>
              <th className="px-4 py-3 font-medium" />
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
            {!isLoading && templates?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Inga återkommande fakturor än.
                </td>
              </tr>
            )}
            {templates?.map((template) => (
              <tr key={template.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">{template.customerName}</td>
                <td className="px-4 py-3">{INTERVAL_LABELS[template.interval]}</td>
                <td className="px-4 py-3">{toDateOnly(template.nextGenerationDate)}</td>
                <td className="px-4 py-3">
                  {template.isActive ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      aktiv
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      pausad
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">{formatSEK(template.totalInclVat)}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/invoice-templates/${template.id}/edit`}
                    className="mr-4 text-slate-600 underline"
                  >
                    Redigera
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      toggleMutation.mutate({ id: template.id, isActive: !template.isActive })
                    }
                    className="mr-4 text-slate-600 underline"
                  >
                    {template.isActive ? "Pausa" : "Aktivera"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Radera den återkommande fakturan för ${template.customerName}? Redan skickade fakturor påverkas inte.`,
                        )
                      ) {
                        deleteMutation.mutate(template.id);
                      }
                    }}
                    className="text-red-600 underline"
                  >
                    Radera
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

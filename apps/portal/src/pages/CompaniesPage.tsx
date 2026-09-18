import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import * as companiesApi from "../api/companies";
import { useAuth } from "../auth/AuthContext";
import { formatSEK } from "../lib/money";

export function CompaniesPage() {
  const { switchCompany } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["companies", "overview"],
    queryFn: () => companiesApi.getOverview(),
  });

  async function openCompany(tenantId: number) {
    await switchCompany(tenantId);
    navigate("/", { replace: true });
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-6 text-xl font-semibold">Dina företag</h1>

      {isLoading && <p className="text-slate-500">Laddar…</p>}
      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          Kunde inte hämta dina företag.
        </p>
      )}

      {data && data.companies.length === 0 && (
        <p className="text-slate-500">Inga företag kopplade till det här BankID:t.</p>
      )}

      <div className="space-y-3">
        {data?.companies.map((company) => (
          <button
            key={company.tenantId}
            type="button"
            onClick={() => void openCompany(company.tenantId)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-slate-300"
          >
            <div>
              <p className="font-medium">{company.tenantName}</p>
              <p className="text-sm text-slate-500">
                {company.outstandingInvoiceCount === 0
                  ? "Inga obetalda fakturor"
                  : `${company.outstandingInvoiceCount} obetald${company.outstandingInvoiceCount === 1 ? "" : "a"} faktura${company.outstandingInvoiceCount === 1 ? "" : "r"}`}
              </p>
            </div>
            <div className="text-right">
              <p className="font-medium">{formatSEK(company.outstanding)}</p>
              <p className="text-sm text-slate-400">Öppna →</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

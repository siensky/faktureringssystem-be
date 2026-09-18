import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  // Pilen ska bara synas när man är INNE på ett företag (fakturalistan,
  // en fakturadetalj) — inte på /companies själv, annars leder den bara
  // tillbaka till sidan man redan står på.
  const showBackToCompanies =
    (user?.companies?.length ?? 0) > 1 && location.pathname !== "/companies";

  return (
    <div className="min-h-screen bg-cream-50 text-ink-900">
      <div className="h-1 bg-gradient-to-r from-ink-900 via-ink-700 to-mint-500" />
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5">
            {/* Ersätter den tidigare "Byt företag"-knappen bredvid Logga ut
                (kodgranskning): en tillbaka-pil är den vedertagna platsen
                för "gå upp en nivå" när man redan är inne i ett företag,
                i stället för en textknapp bland kontoåtgärderna. */}
            {showBackToCompanies && (
              <Link
                to="/companies"
                aria-label="Tillbaka till dina företag"
                title="Tillbaka till dina företag"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-50 hover:text-ink-900"
              >
                ←
              </Link>
            )}
            <Link to="/" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-900 text-sm font-bold text-mint-300">
                {user?.tenantName?.charAt(0).toUpperCase() ?? "F"}
              </span>
              <span className="text-base font-semibold tracking-tight text-ink-900">
                {user?.tenantName} <span className="font-normal text-mist-400">· mina sidor</span>
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-5 text-sm text-mist-500">
            {/* BankID-kundidentiteter har email: null (fas 12) — inget fält alls då i stället för ett tomt. */}
            {user?.email && <span className="hidden sm:inline">{user.email}</span>}
            <button
              type="button"
              onClick={() => void logout()}
              className="font-medium text-mist-500 transition hover:text-ink-900"
            >
              Logga ut
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}

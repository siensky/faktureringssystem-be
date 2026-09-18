import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const NAV_ITEMS = [
  { to: "/invoices", label: "Fakturor" },
  { to: "/invoice-templates", label: "Återkommande fakturor" },
  { to: "/customers", label: "Kunder" },
  { to: "/deliveries", label: "Leveranser" },
  { to: "/payments/unmatched", label: "Betalningar" },
];

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <div className="text-lg font-semibold">{user?.tenantName}</div>
            <nav className="mt-2 flex gap-4 text-sm">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    isActive ? "font-medium text-slate-900" : "text-slate-500 hover:text-slate-900"
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <span>{user?.email}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="text-slate-500 hover:text-slate-900"
            >
              Logga ut
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

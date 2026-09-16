import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-semibold">
            {user?.tenantName} — mina sidor
          </Link>
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
      <main className="mx-auto max-w-3xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

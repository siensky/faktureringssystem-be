import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function RequireAuth() {
  const { status, user, logout } = useAuth();
  if (status === "loading") {
    return <div className="p-6 text-slate-500">Laddar…</div>;
  }
  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }
  // Backend gör den riktiga kontrollen (requireAdmin på varje /admin/*-
  // endpoint) — den här är bara för att inte visa en trasig, delvis
  // renderad backoffice-vy för en inloggad icke-admin (t.ex. en kund, när
  // fas 9 finns) innan varje datacall ändå 403:ar.
  if (user?.role !== "admin") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 text-center">
        <p className="text-slate-700">Du saknar behörighet för backoffice.</p>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded border border-slate-300 px-4 py-2 text-sm"
        >
          Logga ut
        </button>
      </div>
    );
  }
  return <Outlet />;
}

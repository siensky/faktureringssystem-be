import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function RequireAuth() {
  const { status, user, logout } = useAuth();
  if (status === "loading") {
    return <div className="p-6 text-mist-500">Laddar…</div>;
  }
  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }
  // Backend gör den riktiga kontrollen (requireCustomer på varje
  // /portal/*-endpoint) — den här är bara för att inte visa en trasig,
  // delvis renderad portalvy för en inloggad admin som råkat hamna här.
  if (user?.role !== "customer") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream-50 text-center">
        <p className="text-ink-700">Den här sidan är för kundportalen, inte för administratörer.</p>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md border border-ink-100 px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-ink-300 hover:bg-ink-50"
        >
          Logga ut
        </button>
      </div>
    );
  }
  return <Outlet />;
}

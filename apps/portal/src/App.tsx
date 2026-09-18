import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { Layout } from "./components/Layout";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { BankIdLoginPage } from "./pages/BankIdLoginPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { InvoiceDetailPage } from "./pages/InvoiceDetailPage";
import { InvoicesPage } from "./pages/InvoicesPage";
import { LoginPage } from "./pages/LoginPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/bankid" element={<BankIdLoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<InvoicesPage />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          {/* Fas 12: bara meningsfull för en BankID-kundidentitet med länkade
              företag — en lösenordskund kan öppna den, men ser bara sitt
              eget (aktuella) företag i listan via /auth/companies/overview. */}
          <Route path="/companies" element={<CompaniesPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

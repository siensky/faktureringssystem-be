import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { Layout } from "./components/Layout";
import { CustomerEditPage } from "./pages/CustomerEditPage";
import { CustomersPage } from "./pages/CustomersPage";
import { DeliveriesPage } from "./pages/DeliveriesPage";
import { InvoiceDetailPage } from "./pages/InvoiceDetailPage";
import { InvoiceFormPage } from "./pages/InvoiceFormPage";
import { InvoiceTemplateFormPage } from "./pages/InvoiceTemplateFormPage";
import { InvoiceTemplatesPage } from "./pages/InvoiceTemplatesPage";
import { InvoicesPage } from "./pages/InvoicesPage";
import { LoginPage } from "./pages/LoginPage";
import { UnmatchedPaymentsPage } from "./pages/UnmatchedPaymentsPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/invoices" replace />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:id/edit" element={<CustomerEditPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/new" element={<InvoiceFormPage />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/invoices/:id/edit" element={<InvoiceFormPage />} />
          <Route path="/invoice-templates" element={<InvoiceTemplatesPage />} />
          <Route path="/invoice-templates/new" element={<InvoiceTemplateFormPage />} />
          <Route path="/invoice-templates/:id/edit" element={<InvoiceTemplateFormPage />} />
          <Route path="/deliveries" element={<DeliveriesPage />} />
          <Route path="/payments/unmatched" element={<UnmatchedPaymentsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

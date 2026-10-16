import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { RequireAuth, PublicOnly, RequiresSetup, RequirePlatformAdmin } from './components/guards.jsx';
import { Toaster } from './components/ui.jsx';
import { useToast } from './context/ToastContext.jsx';
import AppShell from './components/layout.jsx';
import { track, EVENTS } from './services/events.js';

import LandingPage from './pages/Landing.jsx';
import LoginPage from './pages/auth/Login.jsx';
import RegisterPage from './pages/auth/Register.jsx';
import ForgotPasswordPage from './pages/auth/ForgotPassword.jsx';
import ResetPasswordPage from './pages/auth/ResetPassword.jsx';
import VerifyEmailPage from './pages/auth/VerifyEmail.jsx';
import AcceptInvitePage from './pages/auth/AcceptInvite.jsx';
import OnboardingPage from './pages/Onboarding.jsx';
import DashboardPage from './pages/Dashboard.jsx';
import CustomersPage from './pages/customers/Customers.jsx';
import CustomerNewPage from './pages/customers/CustomerForm.jsx';
import CustomerEditPage from './pages/customers/CustomerForm.jsx';
import CustomerDetailPage from './pages/customers/CustomerDetail.jsx';
import ProductsPage from './pages/products/Products.jsx';
import ProductNewPage from './pages/products/ProductForm.jsx';
import ProductEditPage from './pages/products/ProductForm.jsx';
import QuotationsPage from './pages/quotations/Quotations.jsx';
import QuotationNewPage from './pages/quotations/QuotationForm.jsx';
import QuotationEditPage from './pages/quotations/QuotationForm.jsx';
import QuotationDetailPage from './pages/quotations/QuotationDetail.jsx';
import InvoicesPage from './pages/invoices/Invoices.jsx';
import InvoiceNewPage from './pages/invoices/InvoiceForm.jsx';
import InvoiceEditPage from './pages/invoices/InvoiceForm.jsx';
import InvoiceDetailPage from './pages/invoices/InvoiceDetail.jsx';
import ReceiptsPage from './pages/receipts/Receipts.jsx';
import ReceiptDetailPage from './pages/receipts/ReceiptDetail.jsx';
import RecurringInvoicesPage from './pages/recurring/RecurringInvoices.jsx';
import RecurringFormPage from './pages/recurring/RecurringForm.jsx';
import CreditNotesPage from './pages/credit-notes/CreditNotes.jsx';
import CreditNoteNewPage from './pages/credit-notes/CreditNoteForm.jsx';
import CreditNoteEditPage from './pages/credit-notes/CreditNoteForm.jsx';
import CreditNoteDetailPage from './pages/credit-notes/CreditNoteDetail.jsx';
import RefundsPage from './pages/refunds/Refunds.jsx';
import ReferralsPage from './pages/Referrals.jsx';
import ReportsPage from './pages/Reports.jsx';
import TeamPage from './pages/Team.jsx';
import SettingsPage from './pages/settings/Settings.jsx';
import CompanySettingsPage from './pages/settings/CompanySettings.jsx';
import DocumentSettingsPage from './pages/settings/DocumentSettings.jsx';
import RemindersPage from './pages/settings/Reminders.jsx';
import CustomFieldsPage from './pages/settings/CustomFields.jsx';
import TemplatesPage from './pages/settings/Templates.jsx';
import ImportPage from './pages/settings/Import.jsx';
import ProfileSettingsPage from './pages/settings/ProfileSettings.jsx';
import AdminPage from './pages/admin/Admin.jsx';
import NotFoundPage from './pages/NotFound.jsx';

/**
 * One PostHog pageview per SPA navigation. Rendering this inside <Routes> is
 * not possible (it would remount per route), so it sits above them and reacts
 * to the location. Path only — no ids, no query strings (they can carry
 * tokens); the route pattern is enough to build funnels.
 */
function RouteAnalytics() {
  const location = useLocation();
  useEffect(() => {
    track(EVENTS.PAGEVIEW, { path: location.pathname });
  }, [location.pathname]);
  return null;
}

export default function App() {
  const { toasts, dismiss } = useToast();
  return (
    <>
      <RouteAnalytics />
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
        <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/accept-invitation" element={<AcceptInvitePage />} />

        {/* Onboarding */}
        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <OnboardingPage />
            </RequireAuth>
          }
        />

        {/* Platform administration (super-admin) — standalone, no tenant needed */}
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <RequirePlatformAdmin>
                <AdminPage />
              </RequirePlatformAdmin>
            </RequireAuth>
          }
        />

        {/* App */}
        <Route
          element={
            <RequireAuth>
              <RequiresSetup>
                <AppShell />
              </RequiresSetup>
            </RequireAuth>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />

          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/new" element={<CustomerNewPage />} />
          <Route path="/customers/:id/edit" element={<CustomerEditPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />

          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/new" element={<ProductNewPage />} />
          <Route path="/products/:id/edit" element={<ProductEditPage />} />

          <Route path="/quotations" element={<QuotationsPage />} />
          <Route path="/quotations/new" element={<QuotationNewPage />} />
          <Route path="/quotations/:id/edit" element={<QuotationEditPage />} />
          <Route path="/quotations/:id" element={<QuotationDetailPage />} />

          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/new" element={<InvoiceNewPage />} />
          <Route path="/invoices/:id/edit" element={<InvoiceEditPage />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />

          <Route path="/receipts" element={<ReceiptsPage />} />
          <Route path="/receipts/:id" element={<ReceiptDetailPage />} />

          <Route path="/recurring" element={<RecurringInvoicesPage />} />
          <Route path="/recurring/new" element={<RecurringFormPage />} />
          <Route path="/recurring/:id/edit" element={<RecurringFormPage />} />

          <Route path="/credit-notes" element={<CreditNotesPage />} />
          <Route path="/credit-notes/new" element={<CreditNoteNewPage />} />
          <Route path="/credit-notes/:id/edit" element={<CreditNoteEditPage />} />
          <Route path="/credit-notes/:id" element={<CreditNoteDetailPage />} />

          <Route path="/refunds" element={<RefundsPage />} />

          <Route path="/referrals" element={<ReferralsPage />} />

          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/team" element={<TeamPage />} />

          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/company" element={<CompanySettingsPage />} />
          <Route path="/settings/documents" element={<DocumentSettingsPage />} />
          <Route path="/settings/reminders" element={<RemindersPage />} />
          <Route path="/settings/custom-fields" element={<CustomFieldsPage />} />
          <Route path="/settings/templates" element={<TemplatesPage />} />
          <Route path="/settings/import" element={<ImportPage />} />
          <Route path="/settings/profile" element={<ProfileSettingsPage />} />
        </Route>

        <Route path="/404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

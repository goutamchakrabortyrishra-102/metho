import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { Toaster } from "sonner";
import LandingPage from "@/pages/LandingPage";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import DashboardLayout from "@/layouts/DashboardLayout";
import DashboardHome from "@/pages/dashboard/DashboardHome";
import WalletPage from "@/pages/dashboard/WalletPage";
import MembersPage from "@/pages/dashboard/MembersPage";
import GenealogyPage from "@/pages/dashboard/GenealogyPage";
import ProductsPage from "@/pages/dashboard/ProductsPage";
import OrdersPage from "@/pages/dashboard/OrdersPage";
import BusinessPage from "@/pages/dashboard/BusinessPage";
import ProfilePage from "@/pages/dashboard/ProfilePage";
import SettingsPage from "@/pages/dashboard/SettingsPage";
import SmartCyclePage from "@/pages/dashboard/SmartCyclePage";
import PendingPaymentsPage from "@/pages/dashboard/PendingPaymentsPage";
import MonthlySettlementPage from "@/pages/dashboard/MonthlySettlementPage";
import MPSClaimsPage from "@/pages/dashboard/MPSClaimsPage";
import PartnersPage from "@/pages/dashboard/PartnersPage";
import ProductApprovalsPage from "@/pages/dashboard/ProductApprovalsPage";
import PartnerApprovalsPage from "@/pages/dashboard/PartnerApprovalsPage";
import AIUpgradePage from "@/pages/dashboard/AIUpgradePage";
import AuditLogPage from "@/pages/dashboard/AuditLogPage";
import SystemHealthPage from "@/pages/dashboard/SystemHealthPage";
import OwnerGuidePage from "@/pages/dashboard/OwnerGuidePage";
import PartnerRegisterPage from "@/pages/PartnerRegisterPage";
import WithdrawalsPage from "@/pages/dashboard/WithdrawalsPage";
import LeaderboardPage from "@/pages/dashboard/LeaderboardPage";
import InvoicePage from "@/pages/InvoicePage";
import WalletStatementPage from "@/pages/WalletStatementPage";
import PartnerDashboardPage from "@/pages/PartnerDashboardPage";
import DirectoryPage from "@/pages/DirectoryPage";
import MethoStorePage from "@/pages/MethoStorePage";
import PartnerShopPage from "@/pages/PartnerShopPage";
import PartnerPayoutStatementPage from "@/pages/PartnerPayoutStatementPage";
import ShopPage from "@/pages/ShopPage";
import PartnerGalleryPage from "@/pages/PartnerGalleryPage";
import InstallPage from "@/pages/InstallPage";
import MethoStoreAdminPage from "@/pages/dashboard/MethoStoreAdminPage";
import MethoStoreOwnerPage from "@/pages/dashboard/MethoStoreOwnerPage";

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

const AdminRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!["super_admin", "company_admin", "admin"].includes(user?.role)) return <Navigate to="/app" replace />;
  return children;
};

const StoreOwnerRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/login?next=/app/metho-store-owner" replace />;
  if (!["store_owner", "metho_store_owner", "owner"].includes(user?.role)) return <Navigate to="/app" replace />;
  return children;
};

const MemberRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user?.role === "partner") return <Navigate to="/partner" replace />;
  return children;
};

const GlobalHomeTab = () => {
  const location = useLocation();
  if (location.pathname === "/") return null;

  return (
    <Link
      to="/"
      className="fixed top-4 right-4 md:top-auto md:bottom-5 z-50 inline-flex items-center rounded-full bg-emerald-900 text-white px-4 py-2 text-sm font-semibold shadow-lg hover:bg-emerald-950 transition-colors"
      data-testid="global-home-tab"
    >
      Home
    </Link>
  );
};

function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <BrowserRouter>
          <Toaster position="top-right" richColors />
          <GlobalHomeTab />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/shop" element={<ShopPage />} />
            <Route path="/install" element={<InstallPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin-login" element={<LoginPage adminOnly />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/invoice/:orderId" element={<PrivateRoute><InvoicePage /></PrivateRoute>} />
            <Route path="/wallet-statement" element={<PrivateRoute><WalletStatementPage /></PrivateRoute>} />
            <Route path="/partner" element={<PrivateRoute><PartnerDashboardPage /></PrivateRoute>} />
            <Route path="/directory" element={<DirectoryPage />} />
            <Route path="/metho-store" element={<MethoStorePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/partner-register" element={<PartnerRegisterPage />} />
            <Route path="/partner-shop/:partnerCode" element={<PartnerShopPage />} />
            <Route path="/gallery/:partnerCode" element={<PartnerGalleryPage />} />
            <Route path="/partner-payout" element={<PrivateRoute><PartnerPayoutStatementPage /></PrivateRoute>} />
            <Route
              path="/app"
              element={
                <MemberRoute>
                  <DashboardLayout />
                </MemberRoute>
              }
            >
              <Route index element={<DashboardHome />} />
              <Route path="smart-cycle" element={<SmartCyclePage />} />
              <Route path="wallet" element={<WalletPage />} />
              <Route path="members" element={<MembersPage />} />
              <Route path="genealogy" element={<GenealogyPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="business" element={<BusinessPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="metho-store-owner" element={<StoreOwnerRoute><MethoStoreOwnerPage /></StoreOwnerRoute>} />
              <Route path="pending-payments" element={<AdminRoute><PendingPaymentsPage /></AdminRoute>} />
              <Route path="settlement" element={<AdminRoute><MonthlySettlementPage /></AdminRoute>} />
              <Route path="mps-claims" element={<AdminRoute><MPSClaimsPage /></AdminRoute>} />
              <Route path="partners" element={<AdminRoute><PartnersPage /></AdminRoute>} />
              <Route path="metho-store-admin" element={<AdminRoute><MethoStoreAdminPage /></AdminRoute>} />
              <Route path="partner-approvals" element={<AdminRoute><PartnerApprovalsPage /></AdminRoute>} />
              <Route path="product-approvals" element={<AdminRoute><ProductApprovalsPage /></AdminRoute>} />
              <Route path="ai-upgrade" element={<AdminRoute><AIUpgradePage /></AdminRoute>} />
              <Route path="audit-log" element={<AdminRoute><AuditLogPage /></AdminRoute>} />
              <Route path="system-health" element={<AdminRoute><SystemHealthPage /></AdminRoute>} />
              <Route path="owner-guide" element={<AdminRoute><OwnerGuidePage /></AdminRoute>} />
              <Route path="withdrawals" element={<AdminRoute><WithdrawalsPage /></AdminRoute>} />
              <Route path="leaderboard" element={<LeaderboardPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </SettingsProvider>
    </AuthProvider>
  );
}

export default App;


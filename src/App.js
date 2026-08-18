import React, { useEffect, Suspense, lazy } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SettingsProvider, useSettings } from "@/contexts/SettingsContext";
import { Toaster } from "sonner";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";

const loadLandingPage = () => import("@/pages/LandingPage");
const loadLoginPage = () => import("@/pages/LoginPage");
const loadRegisterPage = () => import("@/pages/RegisterPage");
const loadForgotPasswordPage = () => import("@/pages/ForgotPasswordPage");
const loadResetPasswordPage = () => import("@/pages/ResetPasswordPage");
const loadDashboardLayout = () => import("@/layouts/DashboardLayout");
const loadDashboardHome = () => import("@/pages/dashboard/DashboardHome");
const loadWalletPage = () => import("@/pages/dashboard/WalletPage");
const loadMembersPage = () => import("@/pages/dashboard/MembersPage");
const loadGenealogyPage = () => import("@/pages/dashboard/GenealogyPage");
const loadProductsPage = () => import("@/pages/dashboard/ProductsPage");
const loadOrdersPage = () => import("@/pages/dashboard/OrdersPage");
const loadBusinessPage = () => import("@/pages/dashboard/BusinessPage");
const loadProfilePage = () => import("@/pages/dashboard/ProfilePage");
const loadSettingsPage = () => import("@/pages/dashboard/SettingsPage");
const loadSmartCyclePage = () => import("@/pages/dashboard/SmartCyclePage");
const loadPendingPaymentsPage = () => import("@/pages/dashboard/PendingPaymentsPage");
const loadMonthlySettlementPage = () => import("@/pages/dashboard/MonthlySettlementPage");
const loadAccountsPage = () => import("@/pages/dashboard/AccountsPage");
const loadMPSClaimsPage = () => import("@/pages/dashboard/MPSClaimsPage");
const loadPartnersPage = () => import("@/pages/dashboard/PartnersPage");
const loadProductApprovalsPage = () => import("@/pages/dashboard/ProductApprovalsPage");
const loadPartnerApprovalsPage = () => import("@/pages/dashboard/PartnerApprovalsPage");
const loadAIUpgradePage = () => import("@/pages/dashboard/AIUpgradePage");
const loadAuditLogPage = () => import("@/pages/dashboard/AuditLogPage");
const loadSystemHealthPage = () => import("@/pages/dashboard/SystemHealthPage");
const loadOwnerGuidePage = () => import("@/pages/dashboard/OwnerGuidePage");
const loadPartnerRegisterPage = () => import("@/pages/PartnerRegisterPage");
const loadWithdrawalsPage = () => import("@/pages/dashboard/WithdrawalsPage");
const loadLeaderboardPage = () => import("@/pages/dashboard/LeaderboardPage");
const loadInvoicePage = () => import("@/pages/InvoicePage");
const loadWalletStatementPage = () => import("@/pages/WalletStatementPage");
const loadPartnerDashboardPage = () => import("@/pages/PartnerDashboardPage");
const loadDirectoryPage = () => import("@/pages/DirectoryPage");
const loadMethoStorePage = () => import("@/pages/MethoStorePage");
const loadPartnerShopPage = () => import("@/pages/PartnerShopPage");
const loadPartnerPayoutStatementPage = () => import("@/pages/PartnerPayoutStatementPage");
const loadPartnerReportsPage = () => import("@/pages/dashboard/PartnerReportsPage");
const loadPartnerInventoryPage = () => import("@/pages/dashboard/PartnerInventoryPage");
const loadShopPage = () => import("@/pages/ShopPage");
const loadPartnerGalleryPage = () => import("@/pages/PartnerGalleryPage");
const loadInstallPage = () => import("@/pages/InstallPage");
const loadMethoStoreAdminPage = () => import("@/pages/dashboard/MethoStoreAdminPage");
const loadAdminTransportPage = () => import("@/pages/dashboard/AdminTransportPage");
const loadAdminStayDiningBookingsPage = () => import("@/pages/dashboard/AdminStayDiningBookingsPage");
const loadAdminPropertyBuySellPage = () => import("@/pages/dashboard/AdminPropertyBuySellPage");
const loadMethoStoreOwnerPage = () => import("@/pages/dashboard/MethoStoreOwnerPage");
const loadCompanyInventoryPage = () => import("@/pages/dashboard/CompanyInventoryPage");
const loadCustomerOrdersAccessPage = () => import("@/pages/CustomerOrdersAccessPage");
const loadCustomerInvoicePage = () => import("@/pages/CustomerInvoicePage");
const loadPrivacyPolicyPage = () => import("@/pages/PrivacyPolicyPage");

const LandingPage = lazy(loadLandingPage);
const LoginPage = lazy(loadLoginPage);
const RegisterPage = lazy(loadRegisterPage);
const ForgotPasswordPage = lazy(loadForgotPasswordPage);
const ResetPasswordPage = lazy(loadResetPasswordPage);
const DashboardLayout = lazy(loadDashboardLayout);
const DashboardHome = lazy(loadDashboardHome);
const WalletPage = lazy(loadWalletPage);
const MembersPage = lazy(loadMembersPage);
const GenealogyPage = lazy(loadGenealogyPage);
const ProductsPage = lazy(loadProductsPage);
const OrdersPage = lazy(loadOrdersPage);
const BusinessPage = lazy(loadBusinessPage);
const ProfilePage = lazy(loadProfilePage);
const SettingsPage = lazy(loadSettingsPage);
const SmartCyclePage = lazy(loadSmartCyclePage);
const PendingPaymentsPage = lazy(loadPendingPaymentsPage);
const MonthlySettlementPage = lazy(loadMonthlySettlementPage);
const AccountsPage = lazy(loadAccountsPage);
const MPSClaimsPage = lazy(loadMPSClaimsPage);
const PartnersPage = lazy(loadPartnersPage);
const ProductApprovalsPage = lazy(loadProductApprovalsPage);
const PartnerApprovalsPage = lazy(loadPartnerApprovalsPage);
const AIUpgradePage = lazy(loadAIUpgradePage);
const AuditLogPage = lazy(loadAuditLogPage);
const SystemHealthPage = lazy(loadSystemHealthPage);
const OwnerGuidePage = lazy(loadOwnerGuidePage);
const PartnerRegisterPage = lazy(loadPartnerRegisterPage);
const WithdrawalsPage = lazy(loadWithdrawalsPage);
const LeaderboardPage = lazy(loadLeaderboardPage);
const InvoicePage = lazy(loadInvoicePage);
const WalletStatementPage = lazy(loadWalletStatementPage);
const PartnerDashboardPage = lazy(loadPartnerDashboardPage);
const DirectoryPage = lazy(loadDirectoryPage);
const MethoStorePage = lazy(loadMethoStorePage);
const PartnerShopPage = lazy(loadPartnerShopPage);
const PartnerPayoutStatementPage = lazy(loadPartnerPayoutStatementPage);
const PartnerReportsPage = lazy(loadPartnerReportsPage);
const PartnerInventoryPage = lazy(loadPartnerInventoryPage);
const ShopPage = lazy(loadShopPage);
const PartnerGalleryPage = lazy(loadPartnerGalleryPage);
const InstallPage = lazy(loadInstallPage);
const MethoStoreAdminPage = lazy(loadMethoStoreAdminPage);
const AdminTransportPage = lazy(loadAdminTransportPage);
const AdminStayDiningBookingsPage = lazy(loadAdminStayDiningBookingsPage);
const AdminPropertyBuySellPage = lazy(loadAdminPropertyBuySellPage);
const MethoStoreOwnerPage = lazy(loadMethoStoreOwnerPage);
const CompanyInventoryPage = lazy(loadCompanyInventoryPage);
const CustomerOrdersAccessPage = lazy(loadCustomerOrdersAccessPage);
const CustomerInvoicePage = lazy(loadCustomerInvoicePage);
const PrivacyPolicyPage = lazy(loadPrivacyPolicyPage);

const prefetchedChunks = new Set();
const prefetchChunk = (loader) => {
  if (typeof loader !== "function" || prefetchedChunks.has(loader)) return;
  prefetchedChunks.add(loader);
  loader().catch(() => {
    prefetchedChunks.delete(loader);
  });
};

const RouteWarmup = () => {
  const location = useLocation();
  useEffect(() => {
    const pathname = String(location.pathname || "");
    const connection = typeof navigator !== "undefined" ? navigator.connection || navigator.mozConnection || navigator.webkitConnection : null;
    const saveDataEnabled = !!connection?.saveData;
    const effectiveType = String(connection?.effectiveType || "").toLowerCase();
    const constrainedNetwork = saveDataEnabled || effectiveType === "slow-2g" || effectiveType === "2g" || effectiveType === "3g";
    if (constrainedNetwork) return;

    const authTargets = [
      loadLoginPage,
      loadRegisterPage,
      loadPartnerRegisterPage,
    ];

    const discoveryTargets = [
      loadDirectoryPage,
      loadMethoStorePage,
      loadCustomerOrdersAccessPage,
    ];

    const appTargets = [
      loadDashboardLayout,
      loadDashboardHome,
      loadProductsPage,
    ];

    let targets = authTargets;
    if (pathname.startsWith("/app")) {
      targets = [...authTargets, ...appTargets];
    } else if (pathname.startsWith("/directory") || pathname.startsWith("/metho-store") || pathname.startsWith("/customer-orders")) {
      targets = [...authTargets, ...discoveryTargets];
    }

    const runPrefetch = () => {
      targets.forEach((loader) => prefetchChunk(loader));
    };

    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(runPrefetch, { timeout: 1800 });
      return () => window.cancelIdleCallback(id);
    }

    const timer = window.setTimeout(runPrefetch, 350);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  return null;
};

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const hasValidToken = Boolean(localStorage.getItem("metho_token"));
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user || !hasValidToken) return <Navigate to="/login" replace />;
  return children;
};

const AdminRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const hasValidToken = Boolean(localStorage.getItem("metho_token"));
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user || !hasValidToken) return <Navigate to="/login" replace />;
  if (!["super_admin", "company_admin", "admin"].includes(user?.role)) return <Navigate to="/app" replace />;
  return children;
};

const StoreOwnerRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const hasValidToken = Boolean(localStorage.getItem("metho_token"));
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user || !hasValidToken) return <Navigate to="/login?next=/app/metho-store-owner" replace />;
  if (!["store_owner", "metho_store_owner", "owner"].includes(user?.role)) return <Navigate to="/app" replace />;
  return children;
};

const MemberRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const hasValidToken = Boolean(localStorage.getItem("metho_token"));
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user || !hasValidToken) return <Navigate to="/login" replace />;
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

const RuntimeMetaBindings = () => {
  const { settings } = useSettings();

  useEffect(() => {
    if (typeof document === "undefined") return;

    const setMeta = (key, keyValue, content) => {
      if (!content) return;
      let node = document.head.querySelector(`meta[${key}="${keyValue}"]`);
      if (!node) {
        node = document.createElement("meta");
        node.setAttribute(key, keyValue);
        document.head.appendChild(node);
      }
      node.setAttribute("content", content);
    };

    const ogImage = settings?.social_share_image_url_full || settings?.site_logo_url_full || "";
    const ogTitle = settings?.site_title || settings?.company_name || "METHO AAY-UPAY";
    const ogDescription = settings?.landing_subheading || settings?.mission_statement || "";

    setMeta("property", "og:image", ogImage);
    setMeta("name", "twitter:image", ogImage);
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("property", "og:title", ogTitle);
    if (ogDescription) {
      setMeta("property", "og:description", ogDescription);
      setMeta("name", "description", ogDescription);
    }
  }, [
    settings?.social_share_image_url_full,
    settings?.site_logo_url_full,
    settings?.site_title,
    settings?.company_name,
    settings?.landing_subheading,
    settings?.mission_statement,
  ]);

  return null;
};

const AdminLegacyRedirect = () => {
  const location = useLocation();
  const legacyPath = String(location.pathname || "").replace(/^\/admin\/?/, "");

  // Keep old /admin links working while rendering the unified full-control dashboard under /app.
  if (!legacyPath) return <Navigate to="/app" replace />;
  if (legacyPath === "product-upload") return <Navigate to="/app/products?upload=1" replace />;

  const nextPath = `/app/${legacyPath}`;
  const nextWithQuery = `${nextPath}${location.search || ""}`;
  return <Navigate to={nextWithQuery} replace />;
};

function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <BrowserRouter>
          <RouteWarmup />
          <RuntimeMetaBindings />
          <Toaster position="top-right" richColors />
          <GlobalHomeTab />
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/shop" element={<ShopPage />} />
              <Route path="/install" element={<InstallPage />} />
              <Route path="/customer-orders" element={<CustomerOrdersAccessPage />} />
              <Route path="/customer-invoice/:orderId" element={<CustomerInvoicePage />} />
              <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
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
              <Route path="/partner-reports" element={<PrivateRoute><PartnerReportsPage /></PrivateRoute>} />
              <Route path="/partner-inventory" element={<PrivateRoute><RouteErrorBoundary><PartnerInventoryPage /></RouteErrorBoundary></PrivateRoute>} />
              <Route path="/partner/inventory" element={<PrivateRoute><RouteErrorBoundary><PartnerInventoryPage /></RouteErrorBoundary></PrivateRoute>} />
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
                <Route path="accounts" element={<AdminRoute><AccountsPage /></AdminRoute>} />
                <Route path="settlement" element={<AdminRoute><MonthlySettlementPage /></AdminRoute>} />
                <Route path="mps-claims" element={<AdminRoute><MPSClaimsPage /></AdminRoute>} />
                <Route path="partners" element={<AdminRoute><PartnersPage /></AdminRoute>} />
                <Route path="metho-store-admin" element={<AdminRoute><MethoStoreAdminPage /></AdminRoute>} />
                <Route path="company-inventory" element={<AdminRoute><CompanyInventoryPage /></AdminRoute>} />
                <Route path="partner-approvals" element={<AdminRoute><PartnerApprovalsPage /></AdminRoute>} />
                <Route path="product-approvals" element={<AdminRoute><ProductApprovalsPage /></AdminRoute>} />
                <Route path="ai-upgrade" element={<AdminRoute><AIUpgradePage /></AdminRoute>} />
                <Route path="audit-log" element={<AdminRoute><AuditLogPage /></AdminRoute>} />
                <Route path="system-health" element={<AdminRoute><SystemHealthPage /></AdminRoute>} />
                <Route path="owner-guide" element={<AdminRoute><OwnerGuidePage /></AdminRoute>} />
                <Route path="withdrawals" element={<AdminRoute><WithdrawalsPage /></AdminRoute>} />
                <Route path="transport-bookings" element={<AdminRoute><AdminTransportPage /></AdminRoute>} />
                <Route path="stay-dining-bookings" element={<AdminRoute><AdminStayDiningBookingsPage /></AdminRoute>} />
                <Route path="property-buy-sell" element={<AdminRoute><AdminPropertyBuySellPage /></AdminRoute>} />
                <Route path="leaderboard" element={<LeaderboardPage />} />
              </Route>
              <Route
                path="/admin/*"
                element={
                  <AdminRoute>
                    <AdminLegacyRedirect />
                  </AdminRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </SettingsProvider>
    </AuthProvider>
  );
}

export default App;


import React, { useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Wallet, Users, Network, Package, ShoppingCart, TrendingUp, User, LogOut, Menu, X, Search, Settings, Sparkles, BadgeIndianRupee, Calculator, Shield, Store, Compass, Trophy, Send, CheckCircle2, Upload, Bot, ClipboardList, Activity, Warehouse, BookOpenCheck, CarTaxiFront, UtensilsCrossed, Building2, BriefcaseBusiness, Trash2, Boxes, Plane, MapPin } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import api from "@/services/api";

const ownerRoles = ["store_owner", "metho_store_owner", "owner"];

const links = [
  { to: "/app", icon: LayoutDashboard, label: "Overview", end: true, testId: "nav-overview" },
  { to: "/app/smart-cycle", icon: Sparkles, label: "Smart Cycle™", testId: "nav-smart-cycle" },
  { to: "/app/wallet", icon: Wallet, label: "Wallet", testId: "nav-wallet" },
  { to: "/app/members", icon: Users, label: "Members", testId: "nav-members" },
  { to: "/app/genealogy", icon: Network, label: "Genealogy", testId: "nav-genealogy" },
  { to: "/app/leaderboard", icon: Trophy, label: "Leaderboard", testId: "nav-leaderboard" },
  { to: "/app/business", icon: TrendingUp, label: "Business", testId: "nav-business" },
  { to: "/app/products", icon: Package, label: "Products", testId: "nav-products" },
  { to: "/app/metho-vegetable-admin?type=metho_vegetable", icon: Package, label: "METHO Vegetable", testId: "nav-metho-vegetable-admin", adminOnly: true },
  { to: "/app/metho-store-owner", icon: Store, label: "Metho Store Owner", testId: "nav-metho-store-owner", ownerOnly: true },
  { to: "/app/products?upload=1", icon: Upload, label: "Image Upload", testId: "nav-product-upload", adminOnly: true },
  { to: "/directory", icon: Compass, label: "Explore Partners", testId: "nav-explore", external: true },
  { to: "/app/metho-store-admin", icon: Warehouse, label: "Store Owner Admin", testId: "nav-metho-store-admin", adminOnly: true },
  { to: "/app/company-inventory", icon: Boxes, label: "Company Inventory", testId: "nav-company-inventory", adminOnly: true },
  { to: "/app/partners", icon: Store, label: "Partners", testId: "nav-partners", adminOnly: true },
  { to: "/app/partner-approvals", icon: CheckCircle2, label: "Partner Applications", testId: "nav-partner-approvals", adminOnly: true },
  { to: "/app/product-approvals", icon: Package, label: "Product Approvals", testId: "nav-product-approvals", adminOnly: true },
  { to: "/app/orders", icon: ShoppingCart, label: "Orders", testId: "nav-orders" },
  { to: "/app/pending-payments", icon: BadgeIndianRupee, label: "Pending Payments", testId: "nav-pending-payments", adminOnly: true },
  { to: "/app/accounts", icon: Calculator, label: "Accounts", testId: "nav-accounts", adminOnly: true },
  { to: "/app/withdrawals", icon: Send, label: "Withdrawals", testId: "nav-withdrawals", adminOnly: true },
  { to: "/app/transport-bookings", icon: CarTaxiFront, label: "Transport Bookings", testId: "nav-transport-bookings", adminOnly: true },
  { to: "/app/active-tracking?sector=transport", icon: MapPin, label: "Active Tracking", testId: "nav-active-tracking", adminOnly: true },
  { to: "/app/stay-dining-bookings", icon: UtensilsCrossed, label: "Stay & Dining Bookings", testId: "nav-stay-dining-bookings", adminOnly: true },
  { to: "/app/tourism-control", icon: Plane, label: "Tourism Control Center", testId: "nav-tourism-control", adminOnly: true },
  { to: "/app/property-buy-sell", icon: Building2, label: "Property Buy & Sell", testId: "nav-property-buy-sell", adminOnly: true },
  { to: "/app/metho-delivery", icon: BriefcaseBusiness, label: "METHO Delivery", testId: "nav-metho-delivery", adminOnly: true },
  { to: "/app/creative-media", icon: BriefcaseBusiness, label: "Creative & Media", testId: "nav-creative-media", adminOnly: true },
  { to: "/app/settlement", icon: Calculator, label: "Settlement", testId: "nav-settlement", adminOnly: true },
  { to: "/app/mps-claims", icon: Shield, label: "MPS Claims", testId: "nav-mps-claims", adminOnly: true },
  { to: "/app/ai-upgrade", icon: Bot, label: "AI Upgrade", testId: "nav-ai-upgrade", adminOnly: true },
  { to: "/app/audit-log", icon: ClipboardList, label: "Audit Log", testId: "nav-audit-log", adminOnly: true },
  { to: "/app/system-health", icon: Activity, label: "System Health", testId: "nav-system-health", adminOnly: true },
  { to: "/app/owner-guide", icon: BookOpenCheck, label: "Owner Guide", testId: "nav-owner-guide", adminOnly: true },
  { to: "/app/profile", icon: User, label: "Profile", testId: "nav-profile" },
  { to: "/app/settings", icon: Settings, label: "Settings", testId: "nav-settings" },
];

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState("");
  const [clearingCurrentData, setClearingCurrentData] = useState(false);
  const nav = useNavigate();
  const location = useLocation();
  const isAdmin = user?.role === "super_admin" || user?.role === "company_admin" || user?.role === "admin";

  React.useEffect(() => {
    if (!String(location.pathname || "").startsWith("/app/partners")) return;
    const params = new URLSearchParams(location.search);
    setHeaderSearch(params.get("search") || "");
  }, [location.pathname, location.search]);

  const handleLogout = () => {
    logout();
    nav("/");
  };

  const runHeaderSearch = () => {
    const term = String(headerSearch || "").trim();
    const params = new URLSearchParams();
    if (term) params.set("search", term);
    nav({ pathname: "/app/partners", search: params.toString() ? `?${params.toString()}` : "" });
  };

  const clearCurrentTestData = async () => {
    if (!isAdmin || clearingCurrentData) return;
    const ok = window.confirm("Clear current test/wrong transaction entries now? This removes current order/payment/booking history for a clean state.");
    if (!ok) return;
    const confirmText = window.prompt("Type CLEAR_CURRENT_DATA to confirm:", "");
    if (String(confirmText || "").trim() !== "CLEAR_CURRENT_DATA") {
      toast.error("Cleanup cancelled: confirmation text did not match");
      return;
    }

    setClearingCurrentData(true);
    try {
      const { data } = await api.post("/admin/reset-current-data", {});
      const deletedOrders = Number(data?.result?.deleted_public_orders || 0);
      const deletedTrips = Number(data?.result?.cleared_transport_bookings || 0);
      toast.success(`Current data cleared. Orders: ${deletedOrders}, transport bookings: ${deletedTrips}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Reset failed");
    } finally {
      setClearingCurrentData(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary/30 flex" data-testid="dashboard-layout">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed md:sticky top-0 left-0 z-40 w-64 h-screen bg-white border-r border-border flex flex-col transition-transform`}>
        <div className="p-5 border-b border-border">
          <Logo showTagline />
        </div>
        <div className="p-3 border-b border-border">
          <div className="bg-emerald-50/50 rounded-lg p-3">
            <p className="text-[10px] uppercase tracking-[0.15em] text-emerald-800 font-semibold">Member Code</p>
            <p className="font-display font-bold text-emerald-950 text-sm" data-testid="sidebar-member-code">{user?.member_code}</p>
            <p className="text-xs text-slate-500 mt-1 font-body capitalize">{user?.role?.replace("_", " ")} · {user?.rank}</p>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {links.filter((l) => {
            const isAdmin = user?.role === "super_admin" || user?.role === "company_admin" || user?.role === "admin";
            if (l.adminOnly && !isAdmin) return false;
            if (l.ownerOnly && !ownerRoles.includes(user?.role)) return false;
            return true;
          }).map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              onClick={() => setSidebarOpen(false)}
              data-testid={l.testId}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg font-body text-sm transition-colors ${
                  isActive
                    ? "bg-emerald-900 text-white shadow-sm"
                    : "text-slate-700 hover:bg-emerald-50 hover:text-emerald-900"
                }`
              }
            >
              <l.icon className="w-4 h-4 shrink-0" />
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <Button onClick={handleLogout} variant="ghost" className="w-full justify-start hover:bg-red-50 hover:text-red-700" data-testid="sidebar-logout-button">
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 bg-black/40 z-30" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 glass border-b border-border">
          <div className="flex items-center justify-between px-4 md:px-8 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="md:hidden p-2 rounded-lg hover:bg-secondary"
                data-testid="mobile-menu-toggle"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <div className="hidden md:flex items-center gap-2 bg-secondary/60 rounded-full px-4 py-2 w-72">
                <Search className="w-4 h-4 text-muted-foreground" />
                <input
                  value={headerSearch}
                  onChange={(e) => setHeaderSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      runHeaderSearch();
                    }
                  }}
                  placeholder="Search partners, city, code..."
                  className="bg-transparent outline-none text-sm flex-1 font-body"
                  data-testid="header-global-search"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isAdmin ? (
                <Button
                  type="button"
                  onClick={clearCurrentTestData}
                  disabled={clearingCurrentData}
                  variant="outline"
                  className="hidden md:inline-flex rounded-full border-red-200 text-red-700 hover:bg-red-50"
                  data-testid="header-clear-current-data"
                >
                  <Trash2 className="w-4 h-4 mr-2" /> {clearingCurrentData ? "Clearing..." : "Clear Test Data"}
                </Button>
              ) : null}
              <div className="flex items-center gap-2 pl-3 border-l border-border">
                <div className="w-9 h-9 rounded-full bg-emerald-900 text-amber-400 flex items-center justify-center font-display font-bold">
                  {user?.name?.[0]?.toUpperCase()}
                </div>
                <div className="hidden md:block">
                  <p className="text-sm font-semibold text-emerald-950 leading-tight" data-testid="header-user-name">{user?.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{user?.rank || "Starter"}</p>
                </div>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}


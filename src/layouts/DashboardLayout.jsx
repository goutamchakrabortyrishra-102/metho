import React, { useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Wallet, Network, ShoppingCart, TrendingUp, User, LogOut, Menu, X, Search, Sparkles, Compass, Gift, UserPlus, CircleHelp } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

const links = [
  { to: "/app", icon: LayoutDashboard, label: "Dashboard", end: true, hash: "", testId: "nav-overview" },
  { to: "/app/wallet#rewards", icon: Gift, label: "My Points & Rewards", hash: "#rewards", testId: "nav-points-rewards" },
  { to: "/app/wallet", icon: Wallet, label: "Wallet", hash: "", testId: "nav-wallet" },
  { to: "/app/orders", icon: ShoppingCart, label: "My Orders", testId: "nav-orders" },
  { to: "/directory", icon: Compass, label: "Explore Partners", testId: "nav-explore" },
  { to: "/app/genealogy", icon: Network, label: "My Network", testId: "nav-genealogy" },
  { to: "/app#invite-grow", icon: UserPlus, label: "Invite & Grow", hash: "#invite-grow", testId: "nav-invite-grow" },
  { to: "/app/smart-cycle", icon: Sparkles, label: "Smart Cycle", testId: "nav-smart-cycle" },
  { to: "/app/business", icon: TrendingUp, label: "MPS", testId: "nav-business" },
  { to: "/app/profile", icon: User, label: "Profile / KYC / Bank", testId: "nav-profile" },
  { href: "tel:+917003805387", icon: CircleHelp, label: "Support", testId: "nav-support" },
];

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState("");
  const nav = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    nav("/");
  };

  const runHeaderSearch = () => {
    const term = String(headerSearch || "").trim();
    if (!term) {
      nav("/directory");
      return;
    }
    nav({ pathname: "/directory", search: `?q=${encodeURIComponent(term)}` });
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
          {links.map(l => (
            l.href ? (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setSidebarOpen(false)}
                data-testid={l.testId}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg font-body text-sm text-slate-700 transition-colors hover:bg-emerald-50 hover:text-emerald-900"
              >
                <l.icon className="w-4 h-4 shrink-0" />
                {l.label}
              </a>
            ) : (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                onClick={() => setSidebarOpen(false)}
                data-testid={l.testId}
                className={({ isActive }) => {
                  const isCurrent = isActive && (l.hash === undefined || location.hash === l.hash);
                  return (
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg font-body text-sm transition-colors ${
                    isCurrent
                      ? "bg-emerald-900 text-white shadow-sm"
                      : "text-slate-700 hover:bg-emerald-50 hover:text-emerald-900"
                  }`
                  );
                }}
              >
                <l.icon className="w-4 h-4 shrink-0" />
                {l.label}
              </NavLink>
            )
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


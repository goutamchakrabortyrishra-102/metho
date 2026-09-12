import React, { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { Calculator, CheckCircle2, ClipboardList, LogOut, Menu, Package, Send, Shield, Store, Upload, Warehouse, X, Activity, BookOpenCheck, Bot, BadgeIndianRupee, Home, Users, Network, MessageCircle, ChartNoAxesCombined, Settings, CarTaxiFront, UtensilsCrossed, Building2, BriefcaseBusiness, Plane, MapPin, Boxes, Truck, Camera } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

const links = [
  { to: "/admin", icon: Home, label: "Admin Home", end: true, testId: "admin-nav-home", section: "Overview" },
  { to: "/admin/metho-store-admin", icon: Warehouse, label: "Store Owner Admin", testId: "admin-nav-metho-store-admin", section: "Business" },
  { to: "/admin/partners", icon: Store, label: "Partners", testId: "admin-nav-partners" },
  { to: "/admin/partner-approvals", icon: CheckCircle2, label: "Partner Applications", testId: "admin-nav-partner-approvals" },
  { to: "/admin/products", icon: Package, label: "Products", testId: "admin-nav-products", section: "Commerce" },
  { to: "/admin/product-approvals", icon: Package, label: "Product Approvals", testId: "admin-nav-product-approvals", section: "Commerce" },
  { to: "/admin/crm/leads", icon: Users, label: "CRM Auto Leads", testId: "admin-nav-crm-leads" },
  { to: "/admin/crm/active-members", icon: Network, label: "Active Members CRM", testId: "admin-nav-crm-active-members" },
  { to: "/admin/crm/pipeline", icon: ClipboardList, label: "CRM Pipeline", testId: "admin-nav-crm-pipeline" },
  { to: "/admin/crm/whatsapp", icon: MessageCircle, label: "WhatsApp Inbox", testId: "admin-nav-crm-whatsapp" },
  { to: "/admin/crm/whatsapp-ai", icon: Bot, label: "WhatsApp AI", testId: "admin-nav-crm-whatsapp-ai" },
  { to: "/admin/pending-payments", icon: BadgeIndianRupee, label: "Pending Payments", testId: "admin-nav-pending-payments" },
  { to: "/admin/accounts", icon: Calculator, label: "Accounts", testId: "admin-nav-accounts", section: "Finance" },
  { to: "/admin/withdrawals", icon: Send, label: "Withdrawals", testId: "admin-nav-withdrawals" },
  { to: "/admin/settlement", icon: Calculator, label: "Settlement", testId: "admin-nav-settlement" },
  { to: "/admin/mps-claims", icon: Shield, label: "MPS Claims", testId: "admin-nav-mps-claims" },
  { to: "/admin/transport-bookings", icon: CarTaxiFront, label: "Transport Bookings", testId: "admin-nav-transport-bookings" },
  { to: "/admin/stay-dining-bookings", icon: UtensilsCrossed, label: "Stay & Dining Bookings", testId: "admin-nav-stay-dining-bookings" },
  { to: "/admin/tourism-control", icon: Plane, label: "Tourism Control", testId: "admin-nav-tourism-control" },
  { to: "/admin/property-buy-sell", icon: Building2, label: "Property Buy & Sell", testId: "admin-nav-property-buy-sell" },
  { to: "/admin/service-sectors", icon: BriefcaseBusiness, label: "Service Sectors", testId: "admin-nav-service-sectors" },
  { to: "/admin/metho-delivery", icon: Truck, label: "METHO Delivery", testId: "admin-nav-metho-delivery" },
  { to: "/admin/shipments", icon: Boxes, label: "Shipments", testId: "admin-nav-shipments" },
  { to: "/admin/creative-media", icon: Camera, label: "Creative & Media", testId: "admin-nav-creative-media" },
  { to: "/admin/driver-registry", icon: CarTaxiFront, label: "Driver & Vehicle Registry", testId: "admin-nav-driver-registry" },
  { to: "/admin/active-tracking", icon: MapPin, label: "Active Tracking", testId: "admin-nav-active-tracking" },
  { to: "/admin/product-upload", icon: Upload, label: "Image Upload", testId: "admin-nav-product-upload", section: "System" },
  { to: "/admin/settings", icon: Settings, label: "Admin Settings / Meta Config", testId: "admin-nav-settings" },
  { to: "/admin/ai-upgrade", icon: Bot, label: "AI Upgrade", testId: "admin-nav-ai-upgrade" },
  { to: "/admin/audit-log", icon: ClipboardList, label: "Audit Log", testId: "admin-nav-audit-log" },
  { to: "/admin/system-health", icon: Activity, label: "System Health", testId: "admin-nav-system-health" },
  { to: "/admin/owner-guide", icon: BookOpenCheck, label: "Owner Guide", testId: "admin-nav-owner-guide" },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const nav = useNavigate();

  const handleLogout = () => {
    logout();
    nav("/");
  };

  return (
    <div className="min-h-screen bg-secondary/30 flex" data-testid="admin-layout">
      <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed md:sticky top-0 left-0 z-40 w-64 h-screen bg-white border-r border-border flex flex-col transition-transform`}>
        <div className="p-5 border-b border-border">
          <Logo showTagline />
        </div>
        <div className="p-3 border-b border-border">
          <div className="bg-emerald-50/50 rounded-lg p-3">
            <p className="text-[10px] uppercase tracking-[0.15em] text-emerald-800 font-semibold">Admin Console</p>
            <p className="font-display font-bold text-emerald-950 text-sm" data-testid="admin-sidebar-user-name">{user?.name}</p>
            <p className="text-xs text-slate-500 mt-1 font-body capitalize">{user?.role?.replace("_", " ")} · Separate admin dashboard</p>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {links.map((link) => (
            <React.Fragment key={link.to}>
            {link.section ? <p className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 first:pt-1">{link.section}</p> : null}
            <NavLink
              to={link.to}
              end={link.end}
              onClick={() => setSidebarOpen(false)}
              data-testid={link.testId}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg font-body text-sm transition-colors ${
                  isActive
                    ? "bg-emerald-900 text-white shadow-sm"
                    : "text-slate-700 hover:bg-emerald-50 hover:text-emerald-900"
                }`
              }
            >
              <link.icon className="w-4 h-4 shrink-0" />
              {link.label}
            </NavLink>
            </React.Fragment>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <Button onClick={handleLogout} variant="ghost" className="w-full justify-start hover:bg-red-50 hover:text-red-700" data-testid="admin-sidebar-logout-button">
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </aside>

      {sidebarOpen && <div className="md:hidden fixed inset-0 bg-black/40 z-30" onClick={() => setSidebarOpen(false)} />}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 glass border-b border-border">
          <div className="flex items-center justify-between px-4 md:px-8 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="md:hidden p-2 rounded-lg hover:bg-secondary"
                data-testid="admin-mobile-menu-toggle"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-800 font-semibold">Admin Login</p>
                <p className="text-sm text-slate-600 font-body">Member, partner, and store-owner panels stay isolated from this console.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 pl-3 border-l border-border">
              <div className="w-9 h-9 rounded-full bg-emerald-900 text-amber-400 flex items-center justify-center font-display font-bold">
                {user?.name?.[0]?.toUpperCase()}
              </div>
              <div className="hidden md:block">
                <p className="text-sm font-semibold text-emerald-950 leading-tight">{user?.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role || "admin"}</p>
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
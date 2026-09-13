import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, BadgeIndianRupee, BriefcaseBusiness, Calculator, CarTaxiFront, CheckCircle2, ClipboardList, Package, RefreshCw, Send, Settings, Shield, Store, TrendingUp, Trophy, Users, UtensilsCrossed, Wallet, Warehouse } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const sections = [
  { to: "/admin/partners", icon: Store, title: "Partners", text: "Manage partner profile, sector, and service/store listings." },
  { to: "/admin/metho-store-admin", icon: Warehouse, title: "Store Owner Admin", text: "Keep Metho Store owner operations isolated from member flows." },
  { to: "/admin/partner-approvals", icon: CheckCircle2, title: "Approvals", text: "Review partner and product approvals from a separate admin queue." },
  { to: "/admin/product-approvals", icon: Package, title: "Product Approvals", text: "Approve or reject partner product uploads before public listing." },
  { to: "/admin/pending-payments", icon: BadgeIndianRupee, title: "Pending Payments", text: "Approve pending payment proofs without entering member dashboard." },
  { to: "/admin/accounts", icon: RefreshCw, title: "Accounts", text: "Track admin finance summary after fresh-start resets." },
  { to: "/admin/withdrawals", icon: Send, title: "Withdrawals", text: "Approve or reject withdrawal requests from the admin side only." },
  { to: "/admin/settlement", icon: Calculator, title: "Settlement", text: "Review partner/member settlement reports and monthly payouts." },
  { to: "/admin/transport-bookings", icon: CarTaxiFront, title: "Transport Bookings", text: "View all ride bookings with pickup, destination, status, and fare. 3 trips per page." },
  { to: "/admin/stay-dining-bookings", icon: UtensilsCrossed, title: "Stay & Dining Bookings", text: "View only stay and dining sector bookings. 3 bookings per page." },
  { to: "/admin/tourism-control", icon: CarTaxiFront, title: "Tourism Control", text: "Manage tour/travel content, destination media, bookings, and partner media assets." },
  { to: "/admin/property-buy-sell", icon: BriefcaseBusiness, title: "Property Buy & Sell", text: "Admin oversight for property and sales service verticals." },
  { to: "/admin/service-sectors", icon: ClipboardList, title: "Service Sectors", text: "Coordinate service sectors, driver/guide assignments and sector configuration." },
  { to: "/admin/metho-delivery", icon: BriefcaseBusiness, title: "METHO Delivery", text: "Control METHO delivery partners, paid bookings, agents, assignment, and live tracking." },
  { to: "/admin/shipments", icon: Package, title: "Shipments", text: "Track logistics and fulfillment movements across active product and booking sectors." },
  { to: "/admin/creative-media", icon: ClipboardList, title: "Creative & Media", text: "Manage creative, music, poetry, dance, recording, and media partners separately." },
  { to: "/admin/driver-registry", icon: CarTaxiFront, title: "Driver & Vehicle Registry", text: "Approve drivers, delivery agents, vehicles, and active GPS eligibility." },
  { to: "/admin/active-tracking?sector=transport", icon: CarTaxiFront, title: "Active Tracking", text: "Switch between transport, delivery, and tour guide live tracking tabs." },
  { to: "/admin/mps-claims", icon: Shield, title: "MPS Claims", text: "Keep MPS claim reviews separate from the member tree." },
  { to: "/admin/audit-log", icon: ClipboardList, title: "Audit Log", text: "Review admin actions and system-side changes in one place." },
  { to: "/admin/system-health", icon: Activity, title: "System Health", text: "Operational summary, queues, health status, and recent admin/service activity." },
  { to: "/admin/settings", icon: Settings, title: "Admin Settings", text: "Restore meta/admin configuration, product settings, smart cycle and admin controls." },
];

const currency = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const currentPeriod = () => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
};

export default function AdminHomePage() {
  const [resetting, setResetting] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    let active = true;
    const { year, month } = currentPeriod();

    Promise.allSettled([
      api.get("/admin/ceo-dashboard"),
      api.get(`/admin/settlement/preview?year=${year}&month=${month}`),
      api.get("/admin/mps-fund"),
      api.get("/admin/system-health"),
    ]).then(([business, settlement, mps, health]) => {
      if (!active) return;
      setSnapshot({
        business: business.status === "fulfilled" ? business.value.data : null,
        settlement: settlement.status === "fulfilled" ? settlement.value.data : null,
        mps: mps.status === "fulfilled" ? mps.value.data : null,
        health: health.status === "fulfilled" ? health.value.data : null,
      });
    }).finally(() => {
      if (active) setSnapshotLoading(false);
    });

    return () => { active = false; };
  }, []);

  const overviewMetrics = [
    { label: "Today's Sales", value: currency(snapshot?.business?.today_sales), icon: BadgeIndianRupee, to: "/admin/ceo-dashboard" },
    { label: "Monthly Sales", value: currency(snapshot?.business?.monthly_sales), icon: TrendingUp, to: "/admin/ceo-dashboard" },
    { label: "Active Members", value: snapshot?.business?.active_members ?? 0, icon: Users, to: "/admin/members" },
    { label: "Active Partners", value: snapshot?.business?.active_partners ?? 0, icon: Store, to: "/admin/partners" },
    { label: "Member Reward Pool", value: currency(snapshot?.settlement?.pool_snapshot?.member_pool), icon: Wallet, to: "/admin/settlement" },
    { label: "Leader Reward Pool", value: currency(snapshot?.settlement?.pool_snapshot?.leader_pool), icon: Trophy, to: "/admin/settlement" },
    { label: "Qualified Leaders", value: snapshot?.settlement?.leader_settlement?.qualified_count ?? 0, icon: CheckCircle2, to: "/admin/settlement" },
    { label: "MPS Available", value: currency(snapshot?.mps?.available_balance), icon: Shield, to: "/admin/mps-claims" },
  ];

  const queueMetrics = [
    { label: "Pending Orders", value: snapshot?.business?.pending_orders ?? 0, to: "/admin/orders" },
    { label: "Pending Withdrawals", value: snapshot?.business?.pending_withdrawals ?? 0, to: "/admin/withdrawals" },
    { label: "Partner Approvals", value: snapshot?.business?.pending_partner_approvals ?? 0, to: "/admin/partner-approvals" },
    { label: "Hot CRM Leads", value: snapshot?.business?.hot_leads ?? 0, to: "/admin/crm/leads" },
  ];

  const clearCurrentData = async () => {
    if (!window.confirm("Clear current admin-side transaction totals and test booking/payment/order data now? This keeps partner/store master data but removes current accumulated transaction history for a fresh start.")) {
      return;
    }

    setResetting(true);
    try {
      const { data } = await api.post("/admin/reset-current-data", {});
      toast.success(data?.message || "Current admin-side transaction data cleared");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    const currentPassword = String(passwordForm.current_password || "").trim();
    const newPassword = String(passwordForm.new_password || "").trim();
    const confirmPassword = String(passwordForm.confirm_password || "").trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Fill current password, new password, and confirm password");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("New password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirm password do not match");
      return;
    }

    setChangingPassword(true);
    try {
      const { data } = await api.post("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success(data?.message || "Password changed");
      setPasswordForm({ current_password: "", new_password: "", confirm_password: "" });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Password change failed");
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-home-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin Console</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Separate Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">This login stays fully separate from member, partner, and store-owner dashboards.</p>
        </div>
        <Button onClick={clearCurrentData} disabled={resetting} className="rounded-full bg-amber-500 hover:bg-amber-600 text-emerald-950" data-testid="admin-reset-current-data-button">
          <AlertTriangle className="w-4 h-4 mr-2" /> {resetting ? "Clearing..." : "Clear Current Data"}
        </Button>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 font-body">
        This reset is one-time operational cleanup. Future partner, service, store, cart, checkout, payment, and booking records will calculate normally again after the fresh start.
      </div>

      <section aria-labelledby="admin-overview-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Live Control Center</p>
            <h2 id="admin-overview-heading" className="font-display font-bold text-2xl text-emerald-950 mt-1">Operational Snapshot</h2>
          </div>
          <Link to="/admin/system-health" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-900 hover:text-emerald-700">
            <Activity className="w-4 h-4" /> System: {snapshotLoading ? "Checking" : (snapshot?.health?.overall_status || "Unavailable")}
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {overviewMetrics.map((metric) => (
            <Link key={metric.label} to={metric.to} className="min-h-28 border border-border bg-white p-4 hover:border-emerald-300 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase text-slate-500">{metric.label}</p>
                <metric.icon className="w-5 h-5 shrink-0 text-emerald-800" />
              </div>
              <p className="mt-4 text-2xl font-black text-emerald-950">{snapshotLoading ? "..." : metric.value}</p>
            </Link>
          ))}
        </div>

        <div className="grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
          {queueMetrics.map((metric) => (
            <Link key={metric.label} to={metric.to} className="flex min-h-20 items-center justify-between gap-3 bg-white px-4 py-3 hover:bg-emerald-50">
              <span className="text-sm font-semibold text-slate-700">{metric.label}</span>
              <span className="text-xl font-black text-emerald-950">{snapshotLoading ? "..." : metric.value}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="rounded-2xl border border-border bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin Security</p>
            <h2 className="font-display font-bold text-xl text-emerald-950 mt-1">Change Admin Password</h2>
            <p className="text-sm text-slate-600 font-body mt-1">Only the logged-in hidden admin can change this password.</p>
          </div>
        </div>
        <form onSubmit={changePassword} className="mt-4 grid gap-3 md:grid-cols-3" data-testid="admin-change-password-form">
          <Input
            type="password"
            value={passwordForm.current_password}
            onChange={(e) => setPasswordForm((prev) => ({ ...prev, current_password: e.target.value }))}
            placeholder="Current password"
            className="h-11"
            data-testid="admin-current-password"
          />
          <Input
            type="password"
            value={passwordForm.new_password}
            onChange={(e) => setPasswordForm((prev) => ({ ...prev, new_password: e.target.value }))}
            placeholder="New password"
            className="h-11"
            data-testid="admin-new-password"
          />
          <Input
            type="password"
            value={passwordForm.confirm_password}
            onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm_password: e.target.value }))}
            placeholder="Confirm new password"
            className="h-11"
            data-testid="admin-confirm-password"
          />
          <div className="md:col-span-3 flex justify-end">
            <Button type="submit" disabled={changingPassword} className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" data-testid="admin-change-password-button">
              {changingPassword ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <Link key={section.to} to={section.to} className="rounded-2xl border border-border bg-white p-5 hover:shadow-md transition-shadow" data-testid={`admin-home-link-${section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
            <section.icon className="w-8 h-8 text-emerald-800" />
            <h2 className="mt-4 font-display font-bold text-xl text-emerald-950">{section.title}</h2>
            <p className="mt-2 text-sm text-slate-600 font-body">{section.text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
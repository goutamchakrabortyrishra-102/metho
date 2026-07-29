import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Activity, AlertTriangle, Bot, ClipboardList, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const STATUS_META = {
  healthy: { label: "Healthy", className: "bg-emerald-100 text-emerald-800" },
  watch: { label: "Watch", className: "bg-amber-100 text-amber-800" },
  attention: { label: "Needs Attention", className: "bg-red-100 text-red-700" },
};

export default function SystemHealthPage() {
  const { user } = useAuth();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get("/admin/system-health");
      setData(data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "System health load failed");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    load();
    const intervalId = setInterval(() => {
      load(true);
    }, 30000);
    return () => clearInterval(intervalId);
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/app" replace />;
  if (loading || !data) return <div className="text-muted-foreground">Loading system health...</div>;

  const statusMeta = STATUS_META[data.overall_status] || STATUS_META.healthy;

  return (
    <div className="space-y-6" data-testid="system-health-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin Monitoring</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">System Health</h1>
          <p className="text-sm text-muted-foreground font-body mt-1 max-w-3xl">
            Live operational summary, pending risk queue, AI/admin activity, and recent notifications on one page.
          </p>
        </div>
        <div className={"rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider " + statusMeta.className} data-testid="system-health-status">
          {statusMeta.label}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={load} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="system-health-refresh">Refresh</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {data.health_items?.map((item) => (
          <div key={item.key} className="bg-white rounded-xl border border-border p-5" data-testid={`health-item-${item.key}`}>
            <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold">{item.label}</p>
            <p className="font-display font-black text-3xl text-emerald-950 mt-2">{item.value}</p>
            <p className={"mt-2 text-xs font-semibold uppercase tracking-wider " + (item.severity === "high" ? "text-red-700" : item.severity === "warning" ? "text-amber-700" : "text-emerald-700")}>
              {item.severity}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
          <div className="flex items-center gap-2 text-emerald-950">
            <Activity className="w-4 h-4" />
            <h2 className="font-display font-bold text-xl">Summary</h2>
          </div>
          <div className="space-y-2 text-sm text-slate-700">
            <p>Total Users: <span className="font-semibold">{data.summary.total_users}</span></p>
            <p>Total Orders: <span className="font-semibold">{data.summary.total_orders}</span></p>
            <p>Total Products: <span className="font-semibold">{data.summary.total_products}</span></p>
            <p>Total Revenue: <span className="font-semibold">₹{Number(data.summary.total_revenue || 0).toLocaleString("en-IN")}</span></p>
            <p>Company Reserve: <span className="font-semibold">₹{Number(data.summary.total_company_reserve || 0).toLocaleString("en-IN")}</span></p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
          <div className="flex items-center gap-2 text-emerald-950">
            <AlertTriangle className="w-4 h-4" />
            <h2 className="font-display font-bold text-xl">Recent Alerts</h2>
          </div>
          <div className="space-y-3">
            {data.recent_notifications?.length ? data.recent_notifications.map((item) => (
              <div key={item.id} className="rounded-xl border border-border p-3">
                <p className="text-sm font-semibold text-emerald-950">{item.message}</p>
                <p className="text-[11px] text-slate-500 mt-1 uppercase tracking-wider">{item.severity || item.type || "notice"}</p>
              </div>
            )) : <p className="text-sm text-slate-500">No recent notifications.</p>}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
          <div className="flex items-center gap-2 text-emerald-950">
            <Bot className="w-4 h-4" />
            <h2 className="font-display font-bold text-xl">Recent AI Requests</h2>
          </div>
          <div className="space-y-3">
            {data.recent_ai_requests?.length ? data.recent_ai_requests.map((item) => (
              <div key={item.id} className="rounded-xl border border-border p-3">
                <p className="text-sm font-semibold text-emerald-950">{item.title}</p>
                <p className="text-[11px] text-slate-500 mt-1 uppercase tracking-wider">{item.status} · {item.risk_level}</p>
              </div>
            )) : <p className="text-sm text-slate-500">No recent AI requests.</p>}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
        <div className="flex items-center gap-2 text-emerald-950">
          <ClipboardList className="w-4 h-4" />
          <h2 className="font-display font-bold text-xl">Recent Admin Activity</h2>
        </div>
        <div className="space-y-3">
          {data.recent_audit_logs?.length ? data.recent_audit_logs.map((item) => (
            <div key={item.id} className="rounded-xl border border-border p-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-emerald-950">{item.summary}</p>
                <p className="text-[11px] text-slate-500 mt-1 uppercase tracking-wider">{item.module} · {item.action} · {item.actor_name}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5" />
                {new Date(item.created_at).toLocaleString()}
              </div>
            </div>
          )) : <p className="text-sm text-slate-500">No recent admin activity.</p>}
        </div>
      </div>
    </div>
  );
}
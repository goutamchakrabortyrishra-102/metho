import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { ClipboardList, Filter, ShieldCheck } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AuditLogPage() {
  const { user } = useAuth();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params = {};
      if (moduleFilter.trim()) params.module = moduleFilter.trim();
      if (actionFilter.trim()) params.action = actionFilter.trim();
      params.limit = 100;
      const { data } = await api.get("/admin/audit-logs", { params });
      setLogs(data || []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Audit logs load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadLogs();
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/app" replace />;

  const uniqueModules = [...new Set(logs.map((item) => item.module).filter(Boolean))];
  const uniqueActions = [...new Set(logs.map((item) => item.action).filter(Boolean))];

  return (
    <div className="space-y-6" data-testid="audit-log-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin Governance</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Audit Log</h1>
          <p className="text-sm text-muted-foreground font-body mt-1 max-w-3xl">
            Settings changes, approval actions, AI workflow decisions, and finance-sensitive admin operations are tracked here.
          </p>
        </div>
        <div className="rounded-full bg-emerald-100 text-emerald-800 px-4 py-2 text-xs font-bold uppercase tracking-wider">
          {logs.length} entries loaded
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-border p-6 space-y-4">
        <div className="flex items-center gap-3 text-emerald-950">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Filter className="w-5 h-5 text-emerald-800" />
          </div>
          <div>
            <h2 className="font-display font-bold text-xl">Filter Logs</h2>
            <p className="text-xs text-muted-foreground">Find critical changes quickly by module or action.</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <Label>Module</Label>
            <Input value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} placeholder={uniqueModules[0] || "e.g. settings"} className="mt-1.5" data-testid="audit-filter-module" />
          </div>
          <div>
            <Label>Action</Label>
            <Input value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} placeholder={uniqueActions[0] || "e.g. settings_update"} className="mt-1.5" data-testid="audit-filter-action" />
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={loadLogs} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="audit-filter-apply">Apply</Button>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => {
                setModuleFilter("");
                setActionFilter("");
                setTimeout(loadLogs, 0);
              }}
              data-testid="audit-filter-reset"
            >
              Reset
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {loading ? <div className="bg-white rounded-2xl border border-border p-6 text-sm text-slate-500">Loading audit logs...</div> : null}
        {!loading && logs.length === 0 ? <div className="bg-white rounded-2xl border border-border p-6 text-sm text-slate-500">No audit logs found for the selected filters.</div> : null}
        {logs.map((item) => (
          <div key={item.id} className="bg-white rounded-2xl border border-border p-5 space-y-4" data-testid={`audit-log-${item.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">{item.module}</span>
                  <span className="rounded-full bg-slate-100 text-slate-700 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">{item.action}</span>
                </div>
                <h3 className="font-semibold text-emerald-950 mt-2">{item.summary}</h3>
                <p className="text-xs text-slate-500 mt-1">{item.actor_name} · {item.actor_role} · {new Date(item.created_at).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2 text-emerald-900">
                <ShieldCheck className="w-4 h-4" />
                <span className="text-xs font-semibold">Target: {item.target_id || "—"}</span>
              </div>
            </div>

            {item.metadata && Object.keys(item.metadata).length > 0 ? (
              <div className="rounded-xl bg-secondary/40 p-4">
                <div className="flex items-center gap-2 mb-2 text-emerald-950">
                  <ClipboardList className="w-4 h-4" />
                  <h4 className="font-semibold">Metadata</h4>
                </div>
                <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words font-mono">{JSON.stringify(item.metadata, null, 2)}</pre>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
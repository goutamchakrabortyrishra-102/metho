import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Building2, CheckCircle2, RefreshCw, Store } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const isPropertyRequest = (item) => {
  const bt = normalizeText(item?.business_type);
  const desc = normalizeText(item?.business_description);
  const meta = (String(item?.business_description || "").match(/Primary Sector:\s*([^\n|]+)/i)?.[1] || "").trim().toLowerCase();
  const source = [bt, desc, meta].join(" ");
  return (
    source.includes("property buy & sell")
    || source.includes("property")
    || source.includes("real estate")
    || source.includes("plot sale")
    || source.includes("flat sale")
    || source.includes("house sale")
    || source.includes("shop sale")
    || source.includes("broker")
  );
};

const isPropertyPartner = (item) => {
  const source = [
    item?.business_type,
    item?.business_name,
    item?.notes,
  ].map((v) => normalizeText(v)).join(" ");
  return (
    source.includes("property")
    || source.includes("real estate")
    || source.includes("buy & sell")
    || source.includes("broker")
  );
};

export default function AdminPropertyBuySellPage() {
  const { user } = useAuth();
  const isAdmin = user && ["super_admin", "company_admin", "admin"].includes(user.role);

  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState([]);
  const [partners, setPartners] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqResp, partnerResp] = await Promise.all([
        api.get("/admin/partner-requests"),
        api.get("/admin/partners"),
      ]);
      const reqItems = Array.isArray(reqResp?.data) ? reqResp.data : [];
      const partnerItems = Array.isArray(partnerResp?.data) ? partnerResp.data : [];
      setRequests(reqItems.filter(isPropertyRequest));
      setPartners(partnerItems.filter(isPropertyPartner));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load property sector data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const pendingRequests = useMemo(
    () => requests.filter((row) => String(row?.status || "").toLowerCase() === "pending"),
    [requests]
  );

  if (!isAdmin) return <Navigate to="/app" replace />;

  return (
    <div className="space-y-6" data-testid="admin-property-buy-sell-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1 inline-flex items-center gap-2">
            <Building2 className="w-8 h-8" /> Property Buy & Sell
          </h1>
          <p className="text-sm text-muted-foreground font-body mt-1">
            Property sector partners and partner-applications monitoring panel.
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => load()}
          disabled={loading}
          data-testid="admin-property-refresh"
        >
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Property Requests</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">{requests.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Pending Requests</p>
          <p className="font-display font-black text-2xl text-amber-700 mt-1">{pendingRequests.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Active Property Partners</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">{partners.filter((p) => p?.active !== false).length}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-5">
        <p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Property Partner Applications</p>
        {requests.length === 0 ? (
          <p className="text-sm text-slate-500 mt-3">No property registration requests found.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {requests.map((row) => (
              <div key={row.id} className="rounded-lg border border-border p-3 text-sm" data-testid={`admin-property-request-${row.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-emerald-950">{row.business_name}</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 uppercase font-bold">{row.status || "pending"}</span>
                </div>
                <p className="text-xs text-slate-600 mt-1">{row.contact_person} · {row.phone}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-border p-5">
        <p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Property Partners</p>
        {partners.length === 0 ? (
          <p className="text-sm text-slate-500 mt-3">No property partners found.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {partners.map((row) => (
              <div key={row.id} className="rounded-lg border border-border p-3 text-sm" data-testid={`admin-property-partner-${row.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-emerald-950 inline-flex items-center gap-1.5"><Store className="w-4 h-4" /> {row.business_name}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-bold ${row.active === false ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{row.active === false ? "inactive" : "active"}</span>
                </div>
                <p className="text-xs text-slate-600 mt-1">{row.partner_code} · {row.phone}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
        <p className="font-semibold inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Flow safety note</p>
        <p className="mt-1">This page is monitoring-only. Approval/edit actions remain in existing admin pages to avoid breaking current flows.</p>
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CarTaxiFront, Compass, MapPin, Package, RefreshCw } from "lucide-react";
import { Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const ADMIN_ROLES = ["super_admin", "company_admin", "admin"];
const TABS = [
  { key: "transport", label: "Transport Drivers", icon: CarTaxiFront },
  { key: "delivery", label: "Delivery Agents", icon: Package },
  { key: "tourism", label: "Tour Guides", icon: Compass },
];
const mapUrl = (location) => {
  const lat = Number(location?.latitude);
  const lng = Number(location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}` : "";
};

export default function ActiveTrackingPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [drivers, setDrivers] = useState([]);
  const [guides, setGuides] = useState([]);
  const [loading, setLoading] = useState(false);
  const tab = TABS.some((item) => item.key === searchParams.get("sector")) ? searchParams.get("sector") : "transport";
  const setTab = (key) => setSearchParams({ sector: key });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [driverResponse, guideResponse] = await Promise.all([api.get("/admin/drivers"), api.get("/admin/tourism/guides")]);
      setDrivers(Array.isArray(driverResponse.data) ? driverResponse.data.filter((item) => item.approval_status === "approved" && item.active) : []);
      setGuides(Array.isArray(guideResponse.data) ? guideResponse.data.filter((item) => item.approval_status === "approved" && item.active) : []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Active tracking data could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (ADMIN_ROLES.includes(user?.role)) load(); }, [user?.role, load]);
  useEffect(() => {
    if (!ADMIN_ROLES.includes(user?.role)) return undefined;
    const intervalId = window.setInterval(load, 10000);
    return () => window.clearInterval(intervalId);
  }, [user?.role, load]);

  const rows = useMemo(() => tab === "tourism" ? guides : drivers.filter((item) => item.service_sector === tab), [drivers, guides, tab]);
  if (!ADMIN_ROLES.includes(user?.role)) return <Navigate to="/app" replace />;

  return <div className="space-y-6" data-testid="active-tracking-page">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin Operations</p><h1 className="mt-1 flex items-center gap-2 font-display text-3xl font-black text-emerald-950"><MapPin className="h-8 w-8 text-sky-700" /> Active Partner Tracking</h1><p className="mt-1 text-sm text-slate-600">All approved active transport drivers, delivery agents, and tour guides in one live view.</p></div><Button variant="outline" className="rounded-full" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button></div>
    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3">{TABS.map(({ key, label, icon: Icon }) => <button key={key} type="button" onClick={() => setTab(key)} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${tab === key ? "border-emerald-900 bg-emerald-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}><Icon className="h-4 w-4" /> {label}</button>)}</div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div className="rounded-xl border border-sky-200 bg-sky-50 p-4"><p className="text-xs uppercase text-slate-500">Active in tab</p><p className="mt-1 font-display text-3xl font-black text-emerald-950">{rows.length}</p></div><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs uppercase text-slate-500">GPS sharing</p><p className="mt-1 font-display text-3xl font-black text-emerald-950">{rows.filter((item) => item.live_location).length}</p></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs uppercase text-slate-500">Last refresh</p><p className="mt-2 text-sm font-semibold text-amber-900">{new Date().toLocaleTimeString()}</p></div></div>
    {rows.length === 0 ? <div className="rounded-xl border border-dashed border-sky-200 bg-white p-10 text-center text-slate-500">No active {tab === "tourism" ? "tour guides" : tab === "delivery" ? "delivery agents" : "transport drivers"} found.</div> : <div className="grid gap-3 md:grid-cols-2">{rows.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-emerald-950">{item.name}</p><p className="mt-1 text-xs text-slate-600">{item.phone || "No mobile"} · {item.vehicle_type || "Tour Guide"}{item.vehicle_number ? ` · ${item.vehicle_number}` : ""}</p><p className="mt-1 text-[11px] text-slate-500">Partner: {item.business_name || item.partner_code || "METHO Tour & Travels"}</p></div><span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase text-emerald-800">Active</span></div><div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">{item.live_location ? <><p className="text-xs font-semibold text-sky-900">GPS updated {new Date(item.live_location.updated_at).toLocaleString()}</p><a href={mapUrl(item.live_location)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sky-800 underline"><MapPin className="h-3.5 w-3.5" /> Open live location</a></> : <p className="text-xs text-slate-500">GPS not sharing yet</p>}</div></article>)}</div>}
  </div>;
}

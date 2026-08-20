import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, RefreshCw } from "lucide-react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const ADMIN_ROLES = ["super_admin", "company_admin", "admin"];
const isCreative = (item) => {
  const sector = String(item.service_sector || "").toLowerCase();
  if (sector) return sector.includes("creative") || sector.includes("media");
  return /singing|music|poetry|recitation|kobita|dance|recording|studio|acting|creative|media/i.test([item.business_type, item.business_name, item.notes, item.business_description].join(" "));
};
const isCreativeOrder = (order) => /singing|music|poetry|recitation|dance|recording|studio|creative|media/i.test(JSON.stringify(order));

export default function AdminCreativeMediaPage() {
  const { user } = useAuth();
  const isAdmin = ADMIN_ROLES.includes(user?.role);
  const [partners, setPartners] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [partnerResponse, orderResponse] = await Promise.all([api.get("/admin/partners"), api.get("/admin/orders/pending")]);
      setPartners(Array.isArray(partnerResponse.data) ? partnerResponse.data.filter(isCreative) : []);
      setOrders(Array.isArray(orderResponse.data) ? orderResponse.data.filter(isCreativeOrder) : []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Creative & Media data could not be loaded");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);
  useEffect(() => { if (!isAdmin) return undefined; const id = window.setInterval(load, 15000); return () => window.clearInterval(id); }, [isAdmin, load]);
  const activePartners = useMemo(() => partners.filter((item) => item.active !== false), [partners]);
  if (!isAdmin) return <Navigate to="/app" replace />;
  return <div className="space-y-6" data-testid="admin-creative-media-page">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.2em] text-violet-800 font-semibold">Admin</p><h1 className="mt-1 flex items-center gap-2 font-display text-3xl font-black text-emerald-950"><BriefcaseBusiness className="h-8 w-8 text-violet-700" /> Creative & Media Control</h1><p className="mt-1 text-sm text-slate-600">Manage singing, music, poetry, dance, recording, studio, and media partners separately.</p></div><Button variant="outline" className="rounded-full" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button></div>
    <div className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs uppercase text-slate-500">Creative Partners</p><p className="mt-1 font-display text-3xl font-black text-emerald-950">{partners.length}</p></div><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs uppercase text-slate-500">Active Partners</p><p className="mt-1 font-display text-3xl font-black text-emerald-950">{activePartners.length}</p></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs uppercase text-slate-500">Pending Orders</p><p className="mt-1 font-display text-3xl font-black text-amber-800">{orders.length}</p></div></div>
    <section className="rounded-xl border border-violet-200 bg-white p-5"><h2 className="font-display text-xl font-bold text-emerald-950">Creative & Media Partners</h2>{partners.length === 0 ? <p className="mt-4 text-sm text-slate-500">No creative partners found.</p> : <div className="mt-4 grid gap-3 md:grid-cols-2">{partners.map((partner) => <article key={partner.id} className="rounded-lg border border-violet-100 bg-violet-50/40 p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold text-emerald-950">{partner.business_name}</p><p className="mt-1 text-xs text-slate-600">{partner.partner_code} · {partner.business_type}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${partner.active === false ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{partner.active === false ? "Inactive" : "Active"}</span></div><p className="mt-2 text-xs text-slate-600">{partner.contact_person || "Contact not set"}{partner.phone ? ` · ${partner.phone}` : ""}</p></article>)}</div>}</section>
    <section className="rounded-xl border border-violet-200 bg-white p-5"><h2 className="font-display text-xl font-bold text-emerald-950">Related Creative Orders</h2>{orders.length === 0 ? <p className="mt-4 text-sm text-slate-500">No creative orders found.</p> : <div className="mt-4 grid gap-3">{orders.map((order) => <article key={order.id} className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-xs text-violet-800">{order.order_no || order.id}</p><p className="mt-1 text-sm text-slate-700">{order.user_name || order.payer_name || "Customer"}</p></div><span className="text-sm font-semibold text-emerald-900">INR {Number(order.total_amount || 0).toLocaleString("en-IN")}</span></article>)}</div>}</section>
  </div>;
}

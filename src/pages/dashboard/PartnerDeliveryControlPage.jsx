import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";

const mapLink = (latitude, longitude) => Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
  ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
  : "";

export default function PartnerDeliveryControlPage() {
  const [data, setData] = useState({ items: [], partner_summary: [], rider_summary: [], total: 0, active: 0, completed: 0, working_riders: 0, partner_due_total: 0, rider_due_total: 0 });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { data: response } = await api.get("/admin/partner-deliveries", { params: { status: status || undefined } });
      setData(response);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Partner deliveries could not be loaded");
    } finally {
      setBusy(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const metrics = [
    ["Deliveries", data.total],
    ["Active", data.active],
    ["Completed", data.completed],
    ["Riders currently working", data.working_riders],
    ["Partner fees due", `₹${Number(data.partner_due_total || 0).toFixed(2)}`],
    ["Rider earnings due", `₹${Number(data.rider_due_total || 0).toFixed(2)}`],
  ];

  return <div className="space-y-5" data-testid="partner-delivery-control">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Admin Operations</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-emerald-950"><Truck className="h-6 w-6" />Partner Order Deliveries</h1></div><Button variant="outline" onClick={load} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />Refresh</Button></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{metrics.map(([label, value]) => <div key={label} className="border border-border bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-emerald-950">{value}</p></div>)}</div>
    <div className="grid gap-4 xl:grid-cols-2">
      {[["By partner", data.partner_summary], ["By rider", data.rider_summary]].map(([title, rows]) => <section key={title} className="overflow-x-auto border border-border bg-white"><h2 className="border-b p-3 font-semibold text-emerald-950">{title}</h2><table className="min-w-full text-left text-xs"><thead className="bg-slate-50"><tr><th className="p-2">Name</th><th className="p-2">Jobs</th><th className="p-2">Active</th><th className="p-2">Delivered</th><th className="p-2">Fee due</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="p-2">{row.name}</td><td className="p-2">{row.total}</td><td className="p-2">{row.active}</td><td className="p-2">{row.completed}</td><td className="p-2">₹{Number(row.fee_due).toFixed(2)}</td></tr>)}{!rows.length ? <tr><td colSpan={5} className="p-3 text-center text-slate-500">No delivery records.</td></tr> : null}</tbody></table></section>)}
    </div>
    <div className="flex flex-wrap gap-2">{[["", "All"], ["assigned", "Assigned"], ["accepted", "Accepted"], ["picked_up", "Picked up"], ["out_for_delivery", "Out for delivery"], ["delivered", "Delivered"]].map(([value, label]) => <Button key={value || "all"} size="sm" variant={status === value ? "default" : "outline"} onClick={() => setStatus(value)}>{label}</Button>)}</div>
    <div className="overflow-x-auto border border-border bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-slate-700"><tr><th className="p-3">Order / Partner</th><th className="p-3">Rider</th><th className="p-3">Route</th><th className="p-3">Status</th><th className="p-3">Fee / Settlement</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id} className="border-t"><td className="p-3"><p className="font-semibold">{item.order_no}</p><p className="text-xs text-slate-500">{item.partner_name}</p></td><td className="p-3"><p>{item.rider_name}</p><p className="text-xs text-slate-500">{item.rider_phone}</p></td><td className="p-3"><p>{item.distance_km} km · {item.customer_name}</p><p className="mt-1 flex gap-3 text-xs">{mapLink(item.pickup_latitude, item.pickup_longitude) ? <a href={mapLink(item.pickup_latitude, item.pickup_longitude)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-800 underline">Pickup <ExternalLink className="h-3 w-3" /></a> : null}{mapLink(item.drop_latitude, item.drop_longitude) ? <a href={mapLink(item.drop_latitude, item.drop_longitude)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-800 underline">Drop <ExternalLink className="h-3 w-3" /></a> : null}</p></td><td className="p-3 capitalize">{item.status.replaceAll("_", " ")}</td><td className="p-3"><p>Partner ₹{Number(item.partner_charge).toFixed(2)}</p><p className="text-xs text-slate-500">Rider ₹{Number(item.rider_earning).toFixed(2)} · {item.partner_payment_status.replaceAll("_", " ")}</p></td></tr>)}{!busy && !data.items.length ? <tr><td colSpan={5} className="p-6 text-center text-slate-500">No partner product deliveries found.</td></tr> : null}</tbody></table></div>
  </div>;
}
import React, { useEffect, useState } from "react";
import { PackageCheck, RefreshCw, Save, Truck } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const shipmentStatuses = ["NOT_CREATED", "READY_TO_SHIP", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "RTO", "CANCELLED"];

export default function ShipmentsPage() {
  const [items, setItems] = useState([]);
  const [provider, setProvider] = useState(null);
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const { data } = await api.get("/admin/shipments", { params: { status: status || undefined } });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setProvider(data?.provider || null);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Shipments could not be loaded");
    } finally { setBusy(false); }
  };

  useEffect(() => { load(); }, [status]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.put(`/admin/shipments/${editing.order_id}`, editing);
      toast.success("Shipment updated");
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Shipment update failed");
    } finally { setBusy(false); }
  };

  const createShipment = async (orderId) => {
    if (!orderId || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/shipments/${orderId}/create`);
      if (data?.ok !== true) throw new Error(data?.message || "Shipment creation failed");
      toast.success(data?.message || "Shipment created");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.response?.data?.detail || error?.message || "Shipment creation failed");
    } finally { setBusy(false); }
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">METHO Operations</p><h1 className="text-2xl font-bold text-slate-900">Shipment Control</h1></div>
      <Button variant="outline" onClick={load} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    </div>

    <div className="grid gap-3 md:grid-cols-3">
      <div className="border border-border bg-white p-4"><p className="text-xs uppercase text-slate-500">Shipping provider</p><p className="mt-1 font-semibold">{provider?.provider || "Not configured"}</p></div>
      <div className="border border-border bg-white p-4"><p className="text-xs uppercase text-slate-500">Provider status</p><p className="mt-1 font-semibold">{provider?.enabled ? (provider?.configured ? "Enabled and configured" : "Enabled, configuration incomplete") : "Disabled"}</p></div>
      <div className="border border-border bg-white p-4"><p className="text-xs uppercase text-slate-500">Shipping orders</p><p className="mt-1 text-2xl font-bold">{items.length}</p></div>
    </div>

    <div className="flex flex-wrap gap-2"><Button size="sm" variant={!status ? "default" : "outline"} onClick={() => setStatus("")}>All</Button>{shipmentStatuses.map((value) => <Button key={value} size="sm" variant={status === value ? "default" : "outline"} onClick={() => setStatus(value)}>{value.replaceAll("_", " ")}</Button>)}</div>

    <div className="overflow-x-auto border border-border bg-white"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="p-3">Order</th><th className="p-3">Customer / Address</th><th className="p-3">Shipment</th><th className="p-3">Courier / AWB</th><th className="p-3">Action</th></tr></thead><tbody>{items.map((item) => { const shipmentDataReady = Boolean(String(item.shipping_address || "").trim()) && Boolean(String(item.shipping_city || "").trim()) && /^\d{6}$/.test(String(item.shipping_pincode || "").trim()) && /^\d{10}$/.test(String(item.customer_phone || "").replace(/\D/g, "")); return <tr key={item.order_id} className="border-t"><td className="p-3"><p className="font-mono text-xs">{item.order_id}</p><p className="mt-1 text-xs text-slate-500">Order: {item.order_status} · INR {item.amount}</p></td><td className="p-3"><p className="font-medium">{item.customer_name || "Customer"}</p><p className="mt-1 max-w-sm text-xs text-slate-500">{item.shipping_address}</p></td><td className="p-3"><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800">{item.shipment_status.replaceAll("_", " ")}</span></td><td className="p-3"><p>{item.courier_name || "-"}</p><p className="font-mono text-xs text-slate-500">{item.awb_number || "No AWB"}</p></td><td className="p-3"><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => createShipment(item.order_id)} disabled={busy || Boolean(item.awb_number) || !shipmentDataReady}><Truck className="mr-1 h-3.5 w-3.5" />{shipmentDataReady ? "Create Shipment" : "Fix Delivery Details"}</Button><Button size="sm" variant="outline" onClick={() => setEditing({ ...item })}>Manage</Button></div></td></tr>; })}{!busy && !items.length ? <tr><td colSpan={5} className="p-6 text-center text-slate-500">No orders with a shipping address found.</td></tr> : null}</tbody></table></div>

    {editing ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto bg-white p-5 shadow-xl"><div className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-emerald-800" /><h2 className="text-lg font-bold">Manage Shipment</h2></div><p className="mt-1 font-mono text-xs text-slate-500">{editing.order_id}</p><div className="mt-4 grid gap-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery details</p><label className="text-sm">Address<Input value={editing.shipping_address || ""} onChange={(event) => setEditing({ ...editing, shipping_address: event.target.value })} className="mt-1" /></label><div className="grid gap-3 md:grid-cols-2"><label className="text-sm">City<Input value={editing.shipping_city || ""} onChange={(event) => setEditing({ ...editing, shipping_city: event.target.value })} className="mt-1" /></label><label className="text-sm">State<Input value={editing.shipping_state || ""} onChange={(event) => setEditing({ ...editing, shipping_state: event.target.value })} className="mt-1" /></label><label className="text-sm">Pincode<Input inputMode="numeric" value={editing.shipping_pincode || ""} onChange={(event) => setEditing({ ...editing, shipping_pincode: event.target.value })} className="mt-1" /></label><label className="text-sm">Phone<Input inputMode="tel" value={editing.customer_phone || ""} onChange={(event) => setEditing({ ...editing, customer_phone: event.target.value })} className="mt-1" /></label></div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shipment details</p><label className="text-sm">Shipment status<select value={editing.shipment_status} onChange={(event) => setEditing({ ...editing, shipment_status: event.target.value })} className="mt-1 w-full rounded-md border border-input p-2">{shipmentStatuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label className="text-sm">Courier name<Input value={editing.courier_name} onChange={(event) => setEditing({ ...editing, courier_name: event.target.value })} className="mt-1" /></label><label className="text-sm">AWB number<Input value={editing.awb_number} onChange={(event) => setEditing({ ...editing, awb_number: event.target.value })} className="mt-1" /></label><label className="text-sm">Tracking URL<Input type="url" value={editing.tracking_url} onChange={(event) => setEditing({ ...editing, tracking_url: event.target.value })} className="mt-1" /></label><label className="text-sm">Notes<textarea value={editing.notes} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border border-input p-2" /></label></div><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} disabled={busy}><Save className="mr-2 h-4 w-4" />Save shipment</Button></div></div></div> : null}
  </div>;
}

import React, { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AdminServiceSectorsPage from "./AdminServiceSectorsPage";

export default function MethoDeliveryAdminPage() {
  const [settings, setSettings] = useState({ metho_delivery_smart_cycle_percent: 0, metho_delivery_reward_pool_percent: 0, metho_rider_share_percent: 70, metho_transport_rates: { bike: 12, e_rickshaw: 16, auto_rickshaw: 20, delivery: 14 } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [earnings, setEarnings] = useState([]);
  const [riders, setRiders] = useState([]);

  useEffect(() => {
    Promise.all([api.get("/settings"), api.get("/admin/metho-move/bookings"), api.get("/admin/metho-move/earnings"), api.get("/admin/riders")])
      .then(([settingsResponse, bookingResponse, earningResponse, riderResponse]) => { const data = settingsResponse.data; setBookings(bookingResponse.data?.bookings || []); setEarnings(earningResponse.data?.earnings || []); setRiders(riderResponse.data?.riders || []); setSettings((current) => ({
        ...current,
        metho_delivery_smart_cycle_percent: Number(data?.metho_delivery_smart_cycle_percent || 0),
        metho_delivery_reward_pool_percent: Number(data?.metho_delivery_reward_pool_percent || 0),
        metho_rider_share_percent: Number(data?.metho_rider_share_percent ?? current.metho_rider_share_percent),
        metho_transport_rates: { ...current.metho_transport_rates, ...(data?.metho_transport_rates || {}) },
      })); })
      .catch((error) => toast.error(error?.response?.data?.detail || "Delivery settings could not be loaded"))
      .finally(() => setLoading(false));
  }, []);

  const save = async (event) => {
    event.preventDefault();
    const smartCycle = Number(settings.metho_delivery_smart_cycle_percent);
    const rewardPool = Number(settings.metho_delivery_reward_pool_percent);
    const riderShare = Number(settings.metho_rider_share_percent);
    const rates = settings.metho_transport_rates || {};
    if (![smartCycle, rewardPool, riderShare, rates.bike, rates.e_rickshaw, rates.auto_rickshaw, rates.delivery].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 10000) || riderShare > 100) {
      toast.error("Both percentages must be between 0 and 100");
      return;
    }
    setSaving(true);
    try {
      await api.put("/settings", { metho_delivery_smart_cycle_percent: smartCycle, metho_delivery_reward_pool_percent: rewardPool, metho_rider_share_percent: riderShare, metho_transport_rates: { bike: Number(rates.bike), e_rickshaw: Number(rates.e_rickshaw), auto_rickshaw: Number(rates.auto_rickshaw), delivery: Number(rates.delivery) } });
      toast.success("METHO Delivery reward settings saved");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Delivery settings could not be saved");
    } finally {
      setSaving(false);
    }
  };

  return <div className="space-y-6">
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-5" data-testid="metho-delivery-reward-settings">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-amber-800 font-semibold">METHO Delivery Finance</p>
        <h2 className="font-display font-bold text-xl text-emerald-950 mt-1">Delivery reward controls</h2>
        <p className="text-sm text-amber-950/80 mt-1">These settings apply only to the dedicated METHO Delivery vertical. Product Smart Cycle settings remain unchanged.</p>
      </div>
      <form onSubmit={save} className="mt-4 grid gap-3 md:grid-cols-3 items-end">
        <label className="text-sm font-semibold text-emerald-950">Smart Cycle %<Input type="number" min="0" max="100" step="0.01" value={settings.metho_delivery_smart_cycle_percent} onChange={(event) => setSettings((current) => ({ ...current, metho_delivery_smart_cycle_percent: event.target.value }))} className="mt-1 bg-white" disabled={loading || saving} /></label>
        <label className="text-sm font-semibold text-emerald-950">Reward Pool %<Input type="number" min="0" max="100" step="0.01" value={settings.metho_delivery_reward_pool_percent} onChange={(event) => setSettings((current) => ({ ...current, metho_delivery_reward_pool_percent: event.target.value }))} className="mt-1 bg-white" disabled={loading || saving} /></label>
        <label className="text-sm font-semibold text-emerald-950">Rider share %<Input type="number" min="0" max="100" step="0.01" value={settings.metho_rider_share_percent} onChange={(event) => setSettings((current) => ({ ...current, metho_rider_share_percent: event.target.value }))} className="mt-1 bg-white" disabled={loading || saving} /></label>
        <label className="text-sm font-semibold text-emerald-950">Bike ₹/km<Input type="number" min="0" max="10000" step="0.01" value={settings.metho_transport_rates.bike} onChange={(event) => setSettings((current) => ({ ...current, metho_transport_rates: { ...current.metho_transport_rates, bike: event.target.value } }))} className="mt-1 bg-white" disabled={loading || saving} /></label>
        <label className="text-sm font-semibold text-emerald-950">E-rickshaw ₹/km<Input type="number" min="0" max="10000" step="0.01" value={settings.metho_transport_rates.e_rickshaw} onChange={(event) => setSettings((current) => ({ ...current, metho_transport_rates: { ...current.metho_transport_rates, e_rickshaw: event.target.value } }))} className="mt-1 bg-white" disabled={loading || saving} /></label>
        <label className="text-sm font-semibold text-emerald-950">Auto-rickshaw ₹/km<Input type="number" min="0" max="10000" step="0.01" value={settings.metho_transport_rates.auto_rickshaw} onChange={(event) => setSettings((current) => ({ ...current, metho_transport_rates: { ...current.metho_transport_rates, auto_rickshaw: event.target.value } }))} className="mt-1 bg-white" disabled={loading || saving} /></label>
        <label className="text-sm font-semibold text-emerald-950">Delivery ₹/km<Input type="number" min="0" max="10000" step="0.01" value={settings.metho_transport_rates.delivery} onChange={(event) => setSettings((current) => ({ ...current, metho_transport_rates: { ...current.metho_transport_rates, delivery: event.target.value } }))} className="mt-1 bg-white" disabled={loading || saving} /></label>
        <Button type="submit" className="rounded-full bg-emerald-900 hover:bg-emerald-950" disabled={loading || saving}><Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save delivery settings"}</Button>
      </form>
    </section>
    <section className="rounded-xl border border-emerald-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-display font-bold text-lg text-emerald-950">Direct METHO Move bookings</h2><span className="text-sm text-slate-500">{bookings.length} total</span></div><div className="mt-4 grid gap-3">{bookings.length ? bookings.map((booking) => <div key={booking.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-emerald-950">{booking.service_type} · ₹{booking.amount} · {booking.status}</p><p className="text-sm text-slate-600">{booking.pickup} → {booking.destination}</p><p className="text-xs text-slate-500">{booking.customer_name} · {booking.customer_phone}</p></div><select value={booking.rider_id || ""} onChange={async (event) => { if (!event.target.value) return; await api.post(`/admin/metho-move/bookings/${booking.id}/assign`, { rider_id: event.target.value }); toast.success("Rider assigned"); window.location.reload(); }} className="h-9 rounded-md border px-2 text-xs"><option value="">Assign online rider</option>{riders.filter((rider) => rider.approval_status === "approved" && rider.is_active && rider.availability === "online").map((rider) => <option key={rider.id} value={rider.id}>{rider.name} · {rider.availability}</option>)}</select></div></div>) : <p className="text-sm text-slate-500">No direct bookings yet.</p>}</div></section>
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-display font-bold text-lg text-emerald-950">Rider earnings and payouts</h2><div className="mt-4 grid gap-2">{earnings.length ? earnings.map((earning) => <div key={earning.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white p-3 text-sm"><span>{earning.rider_id} · ₹{earning.amount} · {earning.status}</span>{earning.status !== "paid" ? <Button size="sm" onClick={async () => { await api.post(`/admin/metho-move/earnings/${earning.id}/pay`); toast.success("Payout marked paid"); window.location.reload(); }}>Mark paid</Button> : null}</div>) : <p className="text-sm text-slate-500">No rider earnings yet.</p>}</div></section>
    <AdminServiceSectorsPage deliveryVertical="metho_delivery" methoDeliveryOnly />
  </div>;
}

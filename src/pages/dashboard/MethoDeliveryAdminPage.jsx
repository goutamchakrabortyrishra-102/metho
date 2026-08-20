import React, { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AdminServiceSectorsPage from "./AdminServiceSectorsPage";

export default function MethoDeliveryAdminPage() {
  const [settings, setSettings] = useState({ metho_delivery_smart_cycle_percent: 0, metho_delivery_reward_pool_percent: 0, metho_transport_rates: { bike: 12, e_rickshaw: 16, auto_rickshaw: 20 } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/settings")
      .then(({ data }) => setSettings((current) => ({
        ...current,
        metho_delivery_smart_cycle_percent: Number(data?.metho_delivery_smart_cycle_percent || 0),
        metho_delivery_reward_pool_percent: Number(data?.metho_delivery_reward_pool_percent || 0),
        metho_transport_rates: { ...current.metho_transport_rates, ...(data?.metho_transport_rates || {}) },
      })))
      .catch((error) => toast.error(error?.response?.data?.detail || "Delivery settings could not be loaded"))
      .finally(() => setLoading(false));
  }, []);

  const save = async (event) => {
    event.preventDefault();
    const smartCycle = Number(settings.metho_delivery_smart_cycle_percent);
    const rewardPool = Number(settings.metho_delivery_reward_pool_percent);
    const rates = settings.metho_transport_rates || {};
    if (![smartCycle, rewardPool, rates.bike, rates.e_rickshaw, rates.auto_rickshaw].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 10000)) {
      toast.error("Both percentages must be between 0 and 100");
      return;
    }
    setSaving(true);
    try {
      await api.put("/settings", { metho_delivery_smart_cycle_percent: smartCycle, metho_delivery_reward_pool_percent: rewardPool, metho_transport_rates: { bike: Number(rates.bike), e_rickshaw: Number(rates.e_rickshaw), auto_rickshaw: Number(rates.auto_rickshaw) } });
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
        <label className="text-sm font-semibold text-emerald-950">Bike ₹/km<Input type="number" min="0" max="10000" step="0.01" value={settings.metho_transport_rates.bike} onChange={(event) => setSettings((current) => ({ ...current, metho_transport_rates: { ...current.metho_transport_rates, bike: event.target.value } }))} className="mt-1 bg-white" disabled={loading || saving} /></label>
        <label className="text-sm font-semibold text-emerald-950">E-rickshaw ₹/km<Input type="number" min="0" max="10000" step="0.01" value={settings.metho_transport_rates.e_rickshaw} onChange={(event) => setSettings((current) => ({ ...current, metho_transport_rates: { ...current.metho_transport_rates, e_rickshaw: event.target.value } }))} className="mt-1 bg-white" disabled={loading || saving} /></label>
        <label className="text-sm font-semibold text-emerald-950">Auto-rickshaw ₹/km<Input type="number" min="0" max="10000" step="0.01" value={settings.metho_transport_rates.auto_rickshaw} onChange={(event) => setSettings((current) => ({ ...current, metho_transport_rates: { ...current.metho_transport_rates, auto_rickshaw: event.target.value } }))} className="mt-1 bg-white" disabled={loading || saving} /></label>
        <Button type="submit" className="rounded-full bg-emerald-900 hover:bg-emerald-950" disabled={loading || saving}><Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save delivery settings"}</Button>
      </form>
    </section>
    <AdminServiceSectorsPage deliveryVertical="metho_delivery" methoDeliveryOnly />
  </div>;
}

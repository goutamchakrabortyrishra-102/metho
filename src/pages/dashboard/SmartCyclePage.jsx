import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, TrendingUp, Users, Award, Clock } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const WEEK_LABELS = ["Week 1", "Week 2", "Week 3", "Week 4", "Bonus Week"];

export default function SmartCyclePage() {
  const { user } = useAuth();
  const isAdmin = ["super_admin", "company_admin", "admin"].includes(String(user?.role || ""));
  const [data, setData] = useState(null);
  const [adminCycles, setAdminCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = () => {
    setLoading(true);
    setLoadError("");
    const requests = [api.get("/smart-cycle/me")];
    if (isAdmin) requests.push(api.get("/admin/smart-cycles"));
    Promise.all(requests)
      .then(([cycleResponse, adminResponse]) => {
        setData(cycleResponse.data);
        setAdminCycles(Array.isArray(adminResponse?.data) ? adminResponse.data : []);
      })
      .catch((err) => {
        setData(null);
        setAdminCycles([]);
        setLoadError(err?.response?.data?.detail || "Smart Cycle data load failed");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [isAdmin]);

  if (loading) return <div className="text-muted-foreground">Loading Smart Cycle...</div>;

  if (loadError) {
    return (
      <div className="space-y-4" data-testid="smart-cycle-load-error">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {loadError}
        </div>
        <Button onClick={load} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full">
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return <div className="text-muted-foreground">No Smart Cycle data found.</div>;

  if (!data.active) {
    return (
      <div className="space-y-6" data-testid="smart-cycle-page">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Personal Engine</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Smart Cycle™</h1>
        </div>
        <div className="bg-gradient-to-br from-emerald-900 to-emerald-950 text-white rounded-2xl p-10 text-center relative overflow-hidden">
          <div className="absolute inset-0 grain opacity-20" />
          <div className="relative">
            <Sparkles className="w-14 h-14 text-amber-400 mx-auto" />
            <h2 className="font-display font-black text-3xl mt-4">Start Your Smart Cycle™</h2>
            <p className="mt-3 text-emerald-100/80 max-w-lg mx-auto font-body">{data.message}</p>
            <p className="mt-4 text-sm text-amber-400 font-semibold">First approved METHO purchase activates your 5-slot recyclable cycle.</p>
          </div>
        </div>
      </div>
    );
  }

  const cycle = data.cycle;
  const week = data.current_week;

  return (
    <div className="space-y-6" data-testid="smart-cycle-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Personal Engine</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Smart Cycle™ #{cycle.cycle_number}</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">
            Started {new Date(cycle.started_at).toLocaleDateString()} • Ends {new Date(cycle.ends_at).toLocaleDateString()}
          </p>
        </div>
        <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-3 py-1.5 rounded-full flex items-center gap-1">
          <Clock className="w-3 h-3" /> {data.current_slot === 5 ? `${data.days_remaining} days left in Bonus Slot` : `Slot ${data.current_slot} · ${data.days_remaining} days left`}
        </span>
      </div>

      {/* Progress ribbon */}
      <div className="bg-white rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-800 font-semibold">Cycle Progress</p>
            <p className="font-display font-bold text-emerald-950">{data.elapsed_days} of {data.total_days} days</p>
          </div>
          <span className="font-display font-black text-2xl text-emerald-900">{data.progress_percent}%</span>
        </div>
        <div className="h-3 bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-700 to-amber-500 transition-all" style={{ width: `${data.progress_percent}%` }} />
        </div>
        <div className="mt-5 grid grid-cols-5 gap-2">
          {WEEK_LABELS.map((label, i) => {
            const isBonus = i === 4;
            const isPast = i < week - 1;
            const isCurrent = i === week - 1;
            return (
              <div key={i} data-testid={`smart-cycle-week-${i+1}`} className={
                "rounded-lg border-2 p-3 text-center transition-all " +
                (isBonus
                  ? "border-amber-500 bg-amber-50"
                  : isCurrent
                  ? "border-emerald-900 bg-emerald-50"
                  : isPast
                  ? "border-emerald-300 bg-emerald-50/40 opacity-70"
                  : "border-border bg-secondary/30")
              }>
                <p className={"text-[10px] font-semibold uppercase tracking-wider " + (isBonus ? "text-amber-800" : "text-emerald-800")}>{label}</p>
                {isBonus ? (
                  <Sparkles className="w-4 h-4 mx-auto mt-2 text-amber-500" />
                ) : (
                  <p className="mt-1 font-display font-bold text-emerald-950 text-sm">
                    {isCurrent ? "Now" : isPast ? "✓" : "•"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {data.slot_history?.length ? (
        <div className="bg-white rounded-xl border border-border p-5">
          <h3 className="font-display font-bold text-emerald-950">Current Cycle Slot History</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {data.slot_history.map((slot) => (
              <div key={slot.slot} className={"rounded-lg border p-3 " + (slot.slot === 5 ? "border-amber-300 bg-amber-50" : "border-border bg-slate-50/50")}>
                <p className="text-xs font-semibold text-emerald-900">Slot {slot.slot} · {slot.status}</p>
                <p className="font-display font-bold text-emerald-950 mt-1">₹{Number(slot.network_sale_excluding_gst || 0).toLocaleString("en-IN")}</p>
                <p className="text-[11px] text-slate-500 mt-1">GST excluded · {slot.order_count} order(s)</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Financial summary */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-border p-5" data-testid="stat-qualified-volume">
          <TrendingUp className="w-6 h-6 text-emerald-800" />
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mt-3">Current Slot Network Sale</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">₹{cycle.qualified_volume.toLocaleString("en-IN")}</p>
          <p className="text-xs text-muted-foreground mt-1">GST excluded · own sale + active referral chain · {cycle.metho_order_count} METHO order{cycle.metho_order_count === 1 ? "" : "s"}</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-900 to-emerald-950 text-white rounded-xl p-5 relative overflow-hidden" data-testid="stat-estimated-bonus">
          <div className="absolute inset-0 grain opacity-20" />
          <div className="relative">
            <Sparkles className="w-6 h-6 text-amber-400" />
            <p className="text-[10px] uppercase tracking-[0.15em] text-amber-400 font-semibold mt-3">Slot 5 Estimated Bonus</p>
            <p className="font-display font-black text-2xl mt-1">₹{data.estimated_bonus.toLocaleString("en-IN")}</p>
            <p className="text-xs text-emerald-100/70 mt-1">Only in Slot 5 · {data.settings.smart_cycle_bonus_percent}% of GST-excluded network sale</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-5" data-testid="stat-leader-match">
          <Users className="w-6 h-6 text-amber-600" />
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mt-3">Direct Matching Estimate</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">₹{data.estimated_leader_match.toLocaleString("en-IN")}</p>
          <p className="text-xs text-muted-foreground mt-1">50% of each direct member's Slot 5 commission</p>
        </div>
      </div>

      {/* Past cycles */}
      {data.past_cycles && data.past_cycles.length > 0 ? (
        <div className="bg-white rounded-xl border border-border p-5">
          <h3 className="font-display font-bold text-emerald-950">Cycle History</h3>
          <div className="mt-4 divide-y divide-border">
            {data.past_cycles.map((c) => (
              <div key={c.id} className="py-3 grid grid-cols-4 gap-2 text-sm" data-testid={`past-cycle-${c.cycle_number}`}>
                <div>
                  <p className="text-xs text-muted-foreground">Cycle #{c.cycle_number}</p>
                  <p className="font-semibold text-emerald-950 capitalize">{c.status}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Qualified Volume</p>
                  <p className="font-display font-bold text-emerald-950">₹{(c.qualified_volume || 0).toLocaleString("en-IN")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Bonus Paid</p>
                  <p className="font-display font-bold text-emerald-700">₹{(c.bonus_paid || 0).toLocaleString("en-IN")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Sponsor Match Paid</p>
                  <p className="font-display font-bold text-amber-700">₹{(c.direct_sponsor_match_paid || 0).toLocaleString("en-IN")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {data.matching_history?.length ? (
        <div className="bg-white rounded-xl border border-border p-5">
          <h3 className="font-display font-bold text-emerald-950">Direct Matching History</h3>
          <div className="mt-3 space-y-2">
            {data.matching_history.map((match) => (
              <div key={`${match.from_member_id}-${match.from_cycle_number}-${match.paid_at}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-600">Direct member cycle #{match.from_cycle_number} · source bonus ₹{Number(match.source_commission || 0).toLocaleString("en-IN")}</span>
                <span className="font-display font-bold text-amber-700">+₹{Number(match.amount || 0).toLocaleString("en-IN")}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {isAdmin ? (
        <div className="bg-white rounded-xl border border-border p-5" data-testid="admin-smart-cycle-audit">
          <h3 className="font-display font-bold text-emerald-950">Admin Cycle Audit</h3>
          <p className="text-xs text-slate-500 mt-1">Activated member cycles, settled payouts and direct matching records.</p>
          {adminCycles.length === 0 ? <p className="text-sm text-slate-500 mt-4">No activated member cycles yet.</p> : (
            <div className="mt-4 space-y-3">
              {adminCycles.map((entry) => (
                <div key={entry.user_id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-emerald-950">{entry.member_name} <span className="text-xs text-slate-500">{entry.member_code}</span></p>
                    <span className="text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 px-2 py-1">Cycle #{entry.cycle_number} · Slot {entry.current_slot}</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">Settled cycles: {entry.history?.length || 0} · Direct matches received: {entry.matching_history?.length || 0}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3">
        <Award className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <p className="font-display font-semibold text-amber-950">How it works</p>
          <p className="text-sm text-amber-800/80 font-body mt-1">
            Each slot lasts 7 days. Slots 1–4 build your referral network and carry no cycle commission. In Slot 5,
            {" "}{data.settings.smart_cycle_bonus_percent}% is automatically paid on GST-excluded METHO sale from you and your active referral chain. After Slot 5, the cycle resets to Slot 1 while your genealogy and history stay intact. You receive 50% matching on each direct member's Slot 5 commission.
          </p>
        </div>
      </div>
    </div>
  );
}


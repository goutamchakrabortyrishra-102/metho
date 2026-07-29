import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, TrendingUp, Users, Award, Zap, Loader2, Clock } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";

const WEEK_LABELS = ["Week 1", "Week 2", "Week 3", "Week 4", "Bonus Week"];

export default function SmartCyclePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = () => {
    setLoading(true);
    setLoadError("");
    api.get("/smart-cycle/me")
      .then((r) => setData(r.data))
      .catch((err) => {
        setData(null);
        setLoadError(err?.response?.data?.detail || "Smart Cycle data load failed");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const settle = async () => {
    setSettling(true);
    try {
      const r = await api.post("/smart-cycle/settle");
      toast.success(`Cycle settled! Bonus ₹${r.data.bonus} • Leader Match ₹${r.data.leader_match}`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Settle failed");
    } finally {
      setSettling(false);
    }
  };

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
            <p className="mt-4 text-sm text-amber-400 font-semibold">
              Earn {data.settings?.smart_cycle_bonus_percent}% of Qualified METHO Sales as bonus + {data.settings?.leader_match_percent}% Leader Match for your sponsor.
            </p>
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
        {data.eligible_for_settlement ? (
          <Button
            onClick={settle}
            disabled={settling}
            className="bg-amber-500 hover:bg-amber-600 text-emerald-950 font-bold rounded-full h-12 px-6 shadow-lg"
            data-testid="smart-cycle-settle-button"
          >
            {settling ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Claim Bonus <Zap className="ml-2 w-4 h-4" /></>}
          </Button>
        ) : (
          <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-3 py-1.5 rounded-full flex items-center gap-1">
            <Clock className="w-3 h-3" /> {data.days_remaining} days to Bonus Week
          </span>
        )}
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

      {/* Financial summary */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-border p-5" data-testid="stat-qualified-volume">
          <TrendingUp className="w-6 h-6 text-emerald-800" />
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mt-3">Qualified METHO Sales</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">₹{cycle.qualified_volume.toLocaleString("en-IN")}</p>
          <p className="text-xs text-muted-foreground mt-1">{cycle.metho_order_count} METHO order{cycle.metho_order_count === 1 ? "" : "s"}</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-900 to-emerald-950 text-white rounded-xl p-5 relative overflow-hidden" data-testid="stat-estimated-bonus">
          <div className="absolute inset-0 grain opacity-20" />
          <div className="relative">
            <Sparkles className="w-6 h-6 text-amber-400" />
            <p className="text-[10px] uppercase tracking-[0.15em] text-amber-400 font-semibold mt-3">Estimated Smart Cycle Bonus™</p>
            <p className="font-display font-black text-2xl mt-1">₹{data.estimated_bonus.toLocaleString("en-IN")}</p>
            <p className="text-xs text-emerald-100/70 mt-1">{data.settings.smart_cycle_bonus_percent}% of qualified volume</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-5" data-testid="stat-leader-match">
          <Users className="w-6 h-6 text-amber-600" />
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mt-3">Sponsor's Leader Match™</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">₹{data.estimated_leader_match.toLocaleString("en-IN")}</p>
          <p className="text-xs text-muted-foreground mt-1">{data.settings.leader_match_percent}% of your bonus (paid separately)</p>
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
                  <p className="text-xs text-muted-foreground">Leader Match</p>
                  <p className="font-display font-bold text-amber-700">₹{(c.leader_match_paid || 0).toLocaleString("en-IN")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3">
        <Award className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <p className="font-display font-semibold text-amber-950">How it works</p>
          <p className="text-sm text-amber-800/80 font-body mt-1">
            Buy METHO products through Weeks 1–4 to build Qualified Volume. On Bonus Week (Week 5) you can claim
            {" "}{data.settings.smart_cycle_bonus_percent}% of your qualified sales as Smart Cycle Bonus™. Your sponsor
            {" "}automatically receives a {data.settings.leader_match_percent}% Leader Match Reward™, paid separately by the company.
          </p>
        </div>
      </div>
    </div>
  );
}


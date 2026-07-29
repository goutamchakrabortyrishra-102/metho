import React, { useEffect, useState } from "react";
import api from "@/services/api";
import { TrendingUp, Award, Target, Users } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export default function BusinessPage() {
  const [stats, setStats] = useState(null);
  const [cycle, setCycle] = useState(null);

  useEffect(() => {
    api.get("/business/stats").then(r => setStats(r.data));
    api.get("/business/cycle").then(r => setCycle(r.data));
  }, []);

  if (!stats || !cycle) return <div className="text-muted-foreground">Loading business data...</div>;

  const t = stats.rank_thresholds || { Bronze: 5000, Silver: 20000, Gold: 50000, Diamond: 100000 };
  const ranks = [
    { name: "Starter", min: 0 },
    { name: "Bronze", min: t.Bronze },
    { name: "Silver", min: t.Silver },
    { name: "Gold", min: t.Gold },
    { name: "Diamond", min: t.Diamond },
  ];

  return (
    <div className="space-y-6" data-testid="business-page">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Business Engine</p>
        <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Partner · MPS · Cycle</h1>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-border p-5" data-testid="stat-total-bv">
          <TrendingUp className="w-6 h-6 text-emerald-800" />
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mt-3">Team METHO Sales</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">₹{stats.total_business_volume?.toLocaleString("en-IN")}</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-5" data-testid="stat-mps">
          <Target className="w-6 h-6 text-amber-600" />
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mt-3">MPS Score</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">{stats.mps}</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-5" data-testid="stat-rank">
          <Award className="w-6 h-6 text-amber-600" />
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mt-3">Current Rank</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">{stats.rank}</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-5" data-testid="stat-direct-downline">
          <Users className="w-6 h-6 text-emerald-800" />
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mt-3">Direct Downline</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">{stats.direct_downline}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-emerald-900 to-emerald-950 text-white rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute inset-0 grain opacity-20" />
          <div className="relative">
            <p className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-semibold">Current Business Cycle</p>
            <h3 className="font-display font-black text-3xl mt-2">{cycle.cycle}</h3>
            <div className="mt-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-emerald-100/80">Cycle Sales</span>
                <span className="font-bold">₹{cycle.cycle_bv?.toLocaleString("en-IN")} / ₹{cycle.target_bv?.toLocaleString("en-IN")}</span>
              </div>
              <div className="h-3 bg-emerald-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all" style={{ width: `${cycle.progress_percentage}%` }} />
              </div>
              <p className="text-xs text-emerald-100/60 mt-2 font-body">{cycle.progress_percentage}% completed</p>
            </div>
            <div className="mt-6 pt-6 border-t border-emerald-800">
              <p className="text-xs text-emerald-100/60 uppercase tracking-wider">Reward at Target</p>
              <p className="font-display font-bold text-amber-400 mt-1">{cycle.reward_at_target}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-border p-6">
          <h3 className="font-display font-bold text-emerald-950">Rank Progression</h3>
          <p className="text-xs text-muted-foreground font-body mt-1">Climb through 5 ranks based on total BV</p>
          <div className="mt-6 space-y-3">
            {ranks.map((r, i) => {
              const isCurrent = stats.rank === r.name;
              const isUnlocked = stats.total_business_volume >= r.min;
              return (
                <div key={i} className={`flex items-center justify-between p-3 rounded-lg border ${
                  isCurrent ? "border-amber-400 bg-amber-50" :
                  isUnlocked ? "border-emerald-200 bg-emerald-50/40" :
                  "border-border bg-secondary/30 opacity-60"
                }`} data-testid={`rank-${r.name}`}>
                  <div className="flex items-center gap-3">
                    <Award className={`w-5 h-5 ${isCurrent ? "text-amber-500" : isUnlocked ? "text-emerald-700" : "text-slate-400"}`} />
                    <div>
                      <p className="font-display font-bold text-sm text-emerald-950">{r.name}</p>
                      <p className="text-xs text-muted-foreground">Min Sales: ₹{r.min.toLocaleString("en-IN")}</p>
                    </div>
                  </div>
                  {isCurrent && <span className="text-xs bg-amber-500 text-white font-bold px-2 py-0.5 rounded-full">Current</span>}
                  {!isCurrent && isUnlocked && <span className="text-xs text-emerald-700 font-semibold">Unlocked</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}


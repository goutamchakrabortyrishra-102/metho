import React, { useEffect, useState } from "react";
import { TrendingUp, Zap, Target, CheckCircle2, X } from "lucide-react";
import api from "@/services/api";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * MonthlyProjectionCard — shows the member's real-time current-month points,
 * projected reward, and leader eligibility snapshot. Great motivator on wallet/dashboard.
 */
export default function MonthlyProjectionCard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/wallet/monthly-projection").then(r => setData(r.data)).catch(() => {});
  }, []);

  if (!data) return null;

  const nextThreshold = Math.max(100, Math.ceil(data.my_monthly_purchase / 100) * 100 + 100);
  const spendToNext = Math.max(0, nextThreshold - data.my_monthly_purchase);

  return (
    <div className="rounded-xl bg-gradient-to-br from-amber-50 via-emerald-50 to-emerald-100 border-2 border-amber-300 p-6" data-testid="monthly-projection-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-800 font-bold">This Month · {data.period}</p>
          <h3 className="font-display font-black text-2xl text-emerald-950 mt-1">Projected Reward</h3>
          <p className="font-display font-black text-4xl md:text-5xl text-emerald-800 mt-2" data-testid="projected-reward-amount">{inr(data.projected_member_reward)}</p>
          <p className="text-xs text-slate-600 font-body mt-1">
            {data.my_points} points × ₹{data.projected_point_value.toFixed(2)}/point (live estimate)
          </p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-amber-400 text-emerald-950 flex items-center justify-center shrink-0">
          <TrendingUp className="w-6 h-6" />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="bg-white/80 backdrop-blur rounded-lg p-3">
          <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">My Purchase</p>
          <p className="font-display font-black text-lg text-emerald-950">{inr(data.my_monthly_purchase)}</p>
        </div>
        <div className="bg-white/80 backdrop-blur rounded-lg p-3">
          <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">My Points</p>
          <p className="font-display font-black text-lg text-emerald-950">{data.my_points}</p>
        </div>
        <div className="bg-white/80 backdrop-blur rounded-lg p-3">
          <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Point Value</p>
          <p className="font-display font-black text-lg text-emerald-800">₹{data.projected_point_value.toFixed(2)}</p>
        </div>
      </div>

      {spendToNext > 0 && spendToNext <= 100 && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-amber-100 border border-amber-300 px-3 py-2 text-xs text-amber-900" data-testid="spend-hint">
          <Zap className="w-3.5 h-3.5" />
          Spend just <span className="font-bold">{inr(spendToNext)}</span> more this month to earn <span className="font-bold">1 more point</span> = ~{inr(data.projected_point_value)} extra reward!
        </div>
      )}

      {/* Leader qualification snapshot */}
      <div className="mt-4 border-t border-emerald-200 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-3.5 h-3.5 text-emerald-800" />
          <p className="text-[10px] uppercase text-emerald-800 font-bold tracking-widest">Leader Qualification</p>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${data.leader_qualification.qualified ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"}`}>
            {data.leader_qualification.qualified ? "✓ QUALIFIED" : "Not yet"}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
          {Object.entries(data.leader_qualification.checks).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5" data-testid={`leader-check-${k}`}>
              {v.pass ? <CheckCircle2 className="w-3 h-3 text-emerald-700 shrink-0" /> : <X className="w-3 h-3 text-slate-400 shrink-0" />}
              <span className={v.pass ? "text-emerald-800" : "text-slate-500"}>
                {k.replace(/_/g, " ")}: {typeof v.actual === "number" && v.actual > 999 ? inr(v.actual) : v.actual}/{typeof v.required === "number" && v.required > 999 ? inr(v.required) : v.required}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


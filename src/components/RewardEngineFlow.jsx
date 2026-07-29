import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShoppingBag, Building2, Zap, Sparkles, Gift, Users, Shield, ArrowDown, Award } from "lucide-react";
import api from "@/services/api";

const inputPaths = [
  {
    key: "metho",
    icon: Building2,
    label: "METHOO STORE Product Commerce",
    detail: "METHO Sales Volume",
    color: "amber",
    ring: "ring-amber-500",
    dot: "bg-amber-500",
  },
  {
    key: "associate",
    icon: ShoppingBag,
    label: "Associate Partner Commerce",
    detail: "Verified Partner Commission",
    color: "emerald",
    ring: "ring-emerald-600",
    dot: "bg-emerald-600",
  },
];

const buildOutputs = (s) => [
  { icon: Sparkles, title: "Smart Cycle Bonus™", formula: `Qualified METHO × ${s.smart_cycle_bonus_percent}%`, note: "METHO only", tone: "amber" },
  { icon: Award, title: "Leader Match Reward™", formula: `Smart Cycle Bonus × ${s.leader_match_percent}%`, note: "Sponsor's separate payout", tone: "amber" },
  { icon: Gift, title: "Member Reward Pool", formula: `Commission × ${s.commission_split_member_pool}%`, note: "Purchasing member", tone: "emerald" },
  { icon: Users, title: "Leader Reward Pool", formula: `Commission × ${s.commission_split_leader_pool}%`, note: "Sponsor payout", tone: "amber" },
  { icon: Shield, title: "MPS Shield Fund™", formula: `Commission × ${s.commission_split_mps_fund}%`, note: "Safety-net", tone: "emerald" },
];

const DEFAULTS = {
  smart_cycle_bonus_percent: 10,
  metho_commission_percent: 10,
  leader_match_percent: 50,
  commission_split_member_pool: 40,
  commission_split_leader_pool: 20,
  commission_split_mps_fund: 10,
  commission_split_company_fund: 20,
  commission_split_technology_reserve: 10,
};

export default function RewardEngineFlow() {
  const [settings, setSettings] = useState(DEFAULTS);

  useEffect(() => {
    api.get("/settings").then((r) => setSettings({ ...DEFAULTS, ...r.data })).catch(() => {});
  }, []);

  const outputs = buildOutputs(settings);
  return (
    <section id="engine" className="py-24 bg-background relative overflow-hidden">
      <div className="absolute inset-0 grain opacity-30" />
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">The Engine</p>
          <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950">
            Two paths.
            <br />
            <span className="text-amber-500 italic">One intelligent engine.</span>
          </h2>
          <p className="mt-4 text-slate-600 font-body">
            Every purchase — whether METHOO STORE Product or Associate Partner — flows through the same reward-distribution logic. Verified, automated, transparent.
          </p>
        </div>

        <div className="mt-14 relative">
          {/* Input paths */}
          <div className="grid md:grid-cols-2 gap-6">
            {inputPaths.map((p, i) => (
              <motion.div
                key={p.key}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className={`relative bg-white border-2 rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all ${p.ring}`}
                data-testid={`engine-input-${p.key}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl ${p.dot} flex items-center justify-center`}>
                    <p.icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold">Input {i + 1}</p>
                    <h3 className="font-display font-bold text-emerald-950">{p.label}</h3>
                  </div>
                </div>
                <p className="mt-4 text-sm text-slate-600 font-body">→ {p.detail}</p>
              </motion.div>
            ))}
          </div>

          {/* Connector arrows */}
          <div className="grid md:grid-cols-2 gap-6 mt-2">
            {inputPaths.map((p, i) => (
              <div key={i} className="flex justify-center">
                <ArrowDown className={`w-6 h-6 ${p.dot.replace("bg-", "text-")}`} />
              </div>
            ))}
          </div>

          {/* Central engine block */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-2 relative"
          >
            <div className="rounded-3xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950 text-white p-10 md:p-14 shadow-2xl border border-emerald-800 overflow-hidden">
              <div className="absolute inset-0 grain opacity-30" />
              <div className="absolute -top-16 -right-16 w-64 h-64 bg-amber-400/10 rounded-full blur-3xl" />
              <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />
              <div className="relative flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-amber-400 text-emerald-950 flex items-center justify-center shadow-lg">
                  <Zap className="w-7 h-7" />
                </div>
                <p className="mt-4 text-[10px] uppercase tracking-[0.25em] text-amber-400 font-bold">Core Engine</p>
                <h3 className="font-display font-black text-3xl md:text-4xl mt-2">Intelligent Reward Distribution</h3>
                <p className="mt-3 max-w-xl text-emerald-100/80 font-body text-sm">
                  Real-time calculation on every verified purchase. Percentages, splits & thresholds are admin-configurable — no code deploys needed.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2 text-[11px] font-mono">
                  {[
                    `METHO commission = sale × ${settings.metho_commission_percent}%`,
                    `Smart Cycle = qualified × ${settings.smart_cycle_bonus_percent}%`,
                    `Leader Match = Smart Cycle × ${settings.leader_match_percent}%`,
                    `Member Pool = ${settings.commission_split_member_pool}%`,
                    `Leader Pool = ${settings.commission_split_leader_pool}%`,
                    `MPS Fund = ${settings.commission_split_mps_fund}%`,
                    `Company Fund = ${settings.commission_split_company_fund}%`,
                    `Tech Reserve = ${settings.commission_split_technology_reserve}%`,
                  ].map((c, i) => (
                    <span key={i} className="px-3 py-1.5 rounded-full bg-emerald-800/70 text-amber-300 border border-emerald-700">{c}</span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Output arrows */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-4">
            {outputs.map((_, i) => (
              <div key={i} className="flex justify-center">
                <ArrowDown className="w-5 h-5 text-emerald-800" />
              </div>
            ))}
          </div>

          {/* Outputs */}
          <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-4">
            {outputs.map((o, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className={
                  "rounded-2xl p-5 border-2 " +
                  (o.tone === "amber"
                    ? "bg-amber-50/60 border-amber-400"
                    : "bg-emerald-50/60 border-emerald-700")
                }
                data-testid={`engine-output-${i}`}
              >
                <div
                  className={
                    "w-10 h-10 rounded-lg flex items-center justify-center " +
                    (o.tone === "amber" ? "bg-amber-400 text-emerald-950" : "bg-emerald-900 text-amber-400")
                  }
                >
                  <o.icon className="w-5 h-5" />
                </div>
                <h4 className="mt-3 font-display font-bold text-emerald-950 text-sm">{o.title}</h4>
                <p className="mt-1 text-xs text-slate-600 font-mono">{o.formula}</p>
                <p
                  className={
                    "mt-2 inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full " +
                    (o.tone === "amber" ? "bg-amber-500 text-emerald-950" : "bg-emerald-800 text-amber-300")
                  }
                >
                  {o.note}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Classification table */}
          <div className="mt-14 rounded-2xl border border-border bg-white overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-secondary/30">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Purchase Classification</p>
              <h4 className="font-display font-bold text-emerald-950 mt-0.5">What each purchase type unlocks</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40">
                  <tr>
                    <th className="text-left px-6 py-3 font-semibold text-slate-700">Business Activity</th>
                    <th className="text-center px-3 py-3 font-semibold text-slate-700">Smart Cycle</th>
                    <th className="text-center px-3 py-3 font-semibold text-slate-700">Leader Match</th>
                    <th className="text-center px-3 py-3 font-semibold text-slate-700">Value Rewards</th>
                    <th className="text-center px-3 py-3 font-semibold text-slate-700">MPS Shield</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-6 py-4 font-display font-bold text-emerald-950">METHOO STORE Product Purchase</td>
                    <td className="text-center py-4 text-emerald-700 font-black">✓</td>
                    <td className="text-center py-4 text-emerald-700 font-black">✓</td>
                    <td className="text-center py-4 text-emerald-700 font-black">✓</td>
                    <td className="text-center py-4 text-emerald-700 font-black">✓</td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 font-display font-bold text-emerald-950">Associate Partner Purchase</td>
                    <td className="text-center py-4 text-red-500 font-black">✗</td>
                    <td className="text-center py-4 text-red-500 font-black">✗</td>
                    <td className="text-center py-4 text-emerald-700 font-black">✓</td>
                    <td className="text-center py-4 text-emerald-700 font-black">✓</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


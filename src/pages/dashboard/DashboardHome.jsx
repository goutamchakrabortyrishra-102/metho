import React, { useEffect, useState } from "react";
import { Wallet, TrendingUp, Users, ShoppingCart, ArrowUpRight, Award } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import ReferralCard from "@/components/ReferralCard";
import MonthlyProjectionCard from "@/components/MonthlyProjectionCard";

const StatCard = ({ icon: Icon, label, value, suffix, color = "emerald", testId }) => (
  <div className="bg-white rounded-xl border border-border p-5 hover:shadow-md transition-shadow" data-testid={testId}>
    <div className="flex items-center justify-between">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-${color}-100`}>
        <Icon className={`w-5 h-5 text-${color}-800`} />
      </div>
      <ArrowUpRight className="w-4 h-4 text-slate-400" />
    </div>
    <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mt-4">{label}</p>
    <p className="font-display font-black text-2xl text-emerald-950 mt-1">
      {suffix === "₹" ? "₹" : ""}{typeof value === "number" ? value.toLocaleString("en-IN") : value}{suffix && suffix !== "₹" ? ` ${suffix}` : ""}
    </p>
  </div>
);

export default function DashboardHome() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/dashboard/overview").then(r => setData(r.data)).catch(() => {});
  }, []);

  if (!data) return <div className="text-muted-foreground">Loading dashboard...</div>;

  return (
    <div className="space-y-6" data-testid="dashboard-home">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Dashboard</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">
            Welcome back, {user?.name?.split(" ")[0]}
          </h1>
          <p className="text-sm text-muted-foreground font-body mt-1">
            KYC Status: <span className={`font-semibold ${data.kyc_status === "approved" ? "text-emerald-700" : "text-amber-700"}`}>{data.kyc_status}</span>
            <span className="mx-2">·</span>
            Rank: <span className="font-semibold text-emerald-800">{data.rank}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Wallet} label="Wallet Balance" value={data.wallet_balance} suffix="₹" color="emerald" testId="stat-wallet" />
        <StatCard icon={TrendingUp} label="Total Income" value={data.total_income} suffix="₹" color="amber" testId="stat-income" />
        <StatCard icon={Users} label="Downline" value={data.downline_count} color="emerald" testId="stat-downline" />
        <StatCard icon={ShoppingCart} label="Orders" value={data.orders_count} color="amber" testId="stat-orders" />
      </div>

      <ReferralCard downlineCount={data.downline_count} />

      <MonthlyProjectionCard />

      {user?.role === "member" ? (
        <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-amber-50 p-4 md:p-5" data-testid="member-reward-invoice-note">
          <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-800 font-semibold">Member Reward Note</p>
          <div className="mt-3 rounded-lg border border-emerald-100 bg-white/80 p-3 md:p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Guideline</p>
            <h3 className="font-display font-bold text-emerald-950 mt-2 text-base md:text-lg leading-snug">When buying from Associate Partners, always use your own Member ID for billing and collect the invoice on WhatsApp</h3>
            <p className="text-sm md:text-[15px] text-slate-700 font-body mt-2 leading-relaxed">
              This keeps your reward-point calculation accurate, ensures points are counted regularly, and preserves consistent verification records. Please collect the invoice for every purchase.
            </p>
          </div>
          <div className="mt-3 rounded-lg border border-amber-100 bg-white/80 p-3 md:p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">English</p>
            <h3 className="font-display font-bold text-emerald-950 mt-2 text-base md:text-lg leading-snug">When purchasing from Associate Partners, always request billing with your Member ID number and collect the invoice on WhatsApp</h3>
            <p className="text-sm md:text-[15px] text-slate-700 font-body mt-2 leading-relaxed">
              This ensures accurate reward-point calculation, regular point counting, and consistent verification records. Please collect the invoice for every purchase.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-bold text-emerald-950">Income · Last 7 Days</h3>
              <p className="text-xs text-muted-foreground font-body">Daily income tracking</p>
            </div>
            <div className="text-xs bg-emerald-50 text-emerald-800 px-2 py-1 rounded-full font-semibold">Live</div>
          </div>
          <div className="h-64 min-h-[16rem] min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={220}>
              <LineChart data={data.income_chart}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                <XAxis dataKey="day" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }} />
                <Line type="monotone" dataKey="income" stroke="hsl(160, 84%, 25%)" strokeWidth={3} dot={{ r: 4, fill: "hsl(45, 93%, 47%)" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-900 to-emerald-950 text-white rounded-xl p-5 relative overflow-hidden">
          <div className="absolute inset-0 grain opacity-20" />
          <div className="relative">
            <Award className="w-8 h-8 text-amber-400" />
            <p className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-semibold mt-4">Current Rank</p>
            <p className="font-display font-black text-4xl mt-1">{data.rank}</p>
            <div className="mt-4">
              <p className="text-xs text-emerald-100/80 mb-2">Bonus Earned</p>
              <p className="font-display font-bold text-2xl">₹{data.total_bonus?.toLocaleString("en-IN")}</p>
            </div>
            <div className="mt-4 pt-4 border-t border-emerald-800">
              <p className="text-xs text-emerald-100/80">Total Withdrawn</p>
              <p className="font-display font-semibold text-lg">₹{data.total_withdrawn?.toLocaleString("en-IN")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-5">
        <h3 className="font-display font-bold text-emerald-950 mb-4">Recent Transactions</h3>
        <div className="divide-y divide-border">
          {data.recent_transactions.length === 0 && (
            <p className="text-sm text-muted-foreground font-body py-4">No transactions yet. Start selling to see your income here!</p>
          )}
          {data.recent_transactions.map((t, i) => (
            <div key={i} className="py-3 flex items-center justify-between" data-testid={`recent-tx-${i}`}>
              <div>
                <p className="font-semibold text-emerald-950 text-sm">{t.description}</p>
                <p className="text-xs text-muted-foreground font-body capitalize">{t.type?.replace("_", " ")}</p>
              </div>
              <p className={`font-display font-bold ${t.amount > 0 ? "text-emerald-700" : "text-red-700"}`}>
                {t.amount > 0 ? "+" : ""}₹{Math.abs(t.amount).toLocaleString("en-IN")}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


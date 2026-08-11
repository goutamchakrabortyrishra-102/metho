import React, { useEffect, useState } from "react";
import { Trophy, Medal, Users, Star, Sparkles, ArrowUp, PartyPopper, TrendingUp, Store, Download } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import ReferralCard from "@/components/ReferralCard";
import { Button } from "@/components/ui/button";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN")}`;
const RANK_COLORS = {
  Diamond: "text-sky-600 bg-sky-50 border-sky-200",
  Gold: "text-amber-700 bg-amber-50 border-amber-200",
  Silver: "text-slate-700 bg-slate-100 border-slate-300",
  Bronze: "text-yellow-800 bg-yellow-50 border-yellow-200",
  Starter: "text-emerald-800 bg-emerald-50 border-emerald-200",
};
const RANK_GRADIENTS = {
  Diamond: "from-sky-400 via-cyan-500 to-blue-600",
  Gold: "from-amber-300 via-amber-500 to-orange-500",
  Silver: "from-slate-300 via-slate-400 to-slate-500",
  Bronze: "from-orange-300 via-amber-600 to-yellow-800",
  Starter: "from-emerald-400 via-emerald-600 to-emerald-800",
};
const RANK_EMOJI = { Diamond: "💎", Gold: "🥇", Silver: "🥈", Bronze: "🥉", Starter: "🌱" };
const MEDAL_COLORS = ["from-amber-400 to-amber-600", "from-slate-300 to-slate-500", "from-orange-400 to-orange-700"];

const timeAgo = (iso) => {
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
};

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState("month");
  const [data, setData] = useState({ leaders: [] });
  const [rankUps, setRankUps] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [topPartners, setTopPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clearingTestData, setClearingTestData] = useState(false);
  const isAdminView = ["admin", "super_admin", "company_admin"].includes(String(user?.role || "").toLowerCase());

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/leaderboard/referrals?period=${period}&limit=25`).then(r => setData(r.data)).catch(() => setData({ leaders: [] })),
      api.get(`/leaderboard/rank-ups?period=${period}&limit=12`).then(r => setRankUps(r.data.promotions || [])).catch(() => setRankUps([])),
      api.get(`/analytics/top-products?period=${period}&limit=8`).then(r => setTopProducts(r.data.products || [])).catch(() => setTopProducts([])),
      api.get(`/analytics/top-partners?period=${period}&limit=8`).then(r => setTopPartners(r.data.partners || [])).catch(() => setTopPartners([])),
    ]).finally(() => setLoading(false));
  }, [period]);

  const me = data.leaders.find(l => l.user_id === user?.id);
  const myRank = me ? data.leaders.findIndex(l => l.user_id === user?.id) + 1 : null;

  const clearCurrentTestData = async () => {
    if (!isAdminView || clearingTestData) return;
    const proceed = window.confirm("Clear current test/temporary order-booking data now? This keeps partner/member master profiles but removes current transaction history.");
    if (!proceed) return;
    const confirmText = window.prompt("Type CLEAR_CURRENT_DATA to confirm:", "");
    if (String(confirmText || "").trim() !== "CLEAR_CURRENT_DATA") {
      return;
    }
    setClearingTestData(true);
    try {
      const { data: resetData } = await api.post("/admin/reset-current-data", {});
      const deletedOrders = Number(resetData?.result?.deleted_public_orders || 0);
      const clearedTrips = Number(resetData?.result?.cleared_transport_bookings || 0);
      window.alert(`Current test data cleared. Orders removed: ${deletedOrders}, transport bookings removed: ${clearedTrips}.`);
      setLoading(true);
      await Promise.all([
        api.get(`/leaderboard/referrals?period=${period}&limit=25`).then(r => setData(r.data)).catch(() => setData({ leaders: [] })),
        api.get(`/leaderboard/rank-ups?period=${period}&limit=12`).then(r => setRankUps(r.data.promotions || [])).catch(() => setRankUps([])),
        api.get(`/analytics/top-products?period=${period}&limit=8`).then(r => setTopProducts(r.data.products || [])).catch(() => setTopProducts([])),
        api.get(`/analytics/top-partners?period=${period}&limit=8`).then(r => setTopPartners(r.data.partners || [])).catch(() => setTopPartners([])),
      ]);
    } catch (err) {
      window.alert(err?.response?.data?.detail || "Reset failed");
    } finally {
      setClearingTestData(false);
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="leaderboard-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Referral Leaderboard</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1 flex items-center gap-2">
            <Trophy className="w-8 h-8 text-amber-500" /> Top Recruiters
          </h1>
          <p className="text-sm text-muted-foreground font-body mt-1">Ranking for members with the highest number of referrals.</p>
        </div>
        <div className="flex gap-1 bg-white border border-border rounded-full p-1 w-full sm:w-auto overflow-x-auto" data-testid="lb-period-tabs">
          {[{ v: "week", l: "This Week" }, { v: "month", l: "This Month" }, { v: "all", l: "All-time" }].map(o => (
            <button key={o.v} onClick={() => setPeriod(o.v)} className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition ${period === o.v ? "bg-emerald-900 text-white" : "text-slate-600 hover:bg-emerald-50"}`} data-testid={`lb-period-${o.v}`}>{o.l}</button>
          ))}
        </div>
      </div>

      {/* === RANK-UP CELEBRATION FEED === */}
      <RankUpCelebrations items={rankUps} currentUserId={user?.id} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-2xl border border-border p-5" data-testid="top-products-card">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 text-emerald-950">
              <TrendingUp className="w-4 h-4 text-amber-500" />
              <h2 className="font-display font-bold text-xl">Top Selling Products</h2>
            </div>
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{period}</span>
          </div>
          {topProducts.length === 0 ? (
            <p className="text-sm text-slate-500">No sales data yet for this period.</p>
          ) : (
            <div className="space-y-3">
              {topProducts.map((item, index) => (
                <div key={item.product_id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">#{index + 1}</p>
                    <p className="font-semibold text-emerald-950 truncate">{item.name}</p>
                    <p className="text-xs text-slate-500">{item.units_sold} units sold</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-display font-black text-emerald-900">₹{Number(item.sales_amount || 0).toLocaleString("en-IN")}</p>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{item.product_type === "associate_partner" ? "Partner" : "METHO"}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-border p-5" data-testid="top-partners-card">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 text-emerald-950">
              <Store className="w-4 h-4 text-amber-500" />
              <h2 className="font-display font-bold text-xl">Top Performing Partners</h2>
            </div>
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{period}</span>
          </div>
          {topPartners.length === 0 ? (
            <p className="text-sm text-slate-500">No partner sales data yet for this period.</p>
          ) : (
            <div className="space-y-3">
              {topPartners.map((item, index) => (
                <div key={item.partner_id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">#{index + 1}</p>
                    <p className="font-semibold text-emerald-950 truncate">{item.business_name}</p>
                    <p className="text-xs text-slate-500">{item.units_sold} units sold</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-display font-black text-emerald-900">₹{Number(item.sales_amount || 0).toLocaleString("en-IN")}</p>
                    {item.partner_code && <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{item.partner_code}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4" data-testid="leaderboard-paid-only-note">
        <p className="text-xs text-cyan-900 font-semibold">Leaderboard metrics are now shown only after commission credit is completed (paid orders).</p>
        <p className="text-[11px] text-cyan-800 mt-1">Pending approval, pending payment, rejected, and draft/test flow data are excluded automatically.</p>
        {isAdminView ? (
          <div className="mt-3">
            <Button
              type="button"
              onClick={clearCurrentTestData}
              disabled={clearingTestData}
              className="rounded-full bg-red-600 hover:bg-red-700 text-white"
              data-testid="leaderboard-clear-current-data"
            >
              {clearingTestData ? "Clearing..." : "Delete Current Test Transaction Data"}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="bg-gradient-to-br from-emerald-900 to-emerald-950 rounded-2xl p-1 shadow-xl">
        <div className="rounded-[15px] bg-transparent p-0">
          <ReferralCard downlineCount={me?.referral_count ?? 0} />
        </div>
      </div>

      {me && myRank && myRank > 3 && (
        <div className="bg-gradient-to-r from-emerald-950 to-emerald-800 text-white rounded-xl p-4 flex items-center gap-4" data-testid="lb-your-position">
          <div className="w-12 h-12 rounded-full bg-amber-400 text-emerald-950 flex items-center justify-center font-display font-black">#{myRank}</div>
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Your Rank</p>
            <p className="font-display font-black text-lg">{me.name}</p>
            <p className="text-xs text-emerald-100/80">{me.referral_count} referrals · Earned {inr(me.total_bonus_earned)}</p>
          </div>
          <Star className="w-6 h-6 text-amber-400 fill-amber-400" />
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-500">Loading leaderboard...</div>
      ) : data.leaders.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-border">
          <Users className="w-10 h-10 text-slate-400 mx-auto" />
          <p className="mt-3 font-semibold text-emerald-950">No referrals in this period yet</p>
          <p className="text-sm text-muted-foreground mt-1">Share your referral link from Overview page to climb up!</p>
        </div>
      ) : (
        <>
          {/* Podium — top 3 */}
          {data.leaders.length >= 1 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[1, 0, 2].map(i => {
                const l = data.leaders[i];
                if (!l) return <div key={i} className="hidden md:block" />;
                const height = i === 0 ? "md:pt-4" : i === 1 ? "md:pt-8" : "md:pt-12";
                return (
                  <div key={l.user_id} className={height} data-testid={`lb-podium-${i}`}>
                    <div className={`relative bg-white rounded-2xl border-2 ${i === 0 ? "border-amber-400" : "border-border"} p-5 text-center`}>
                      <div className={`absolute -top-4 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-gradient-to-br ${MEDAL_COLORS[i] || "from-slate-300 to-slate-500"} flex items-center justify-center shadow-lg`}>
                        <Medal className="w-5 h-5 text-white" />
                      </div>
                      <p className="mt-4 text-[10px] uppercase tracking-widest text-slate-500 font-bold">#{i + 1} · {l.member_code}</p>
                      <p className="font-display font-black text-lg text-emerald-950 mt-1">{l.name}</p>
                      <p className="font-display font-black text-3xl text-amber-600 mt-2">{l.referral_count}</p>
                      <p className="text-[11px] text-slate-500 font-body">referrals</p>
                      <p className="text-xs text-emerald-800 font-semibold mt-2">Earned {inr(l.total_bonus_earned)}</p>
                      <span className={`inline-block mt-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${RANK_COLORS[l.rank] || RANK_COLORS.Starter}`}>{l.rank}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Rest of the list */}
          {data.leaders.length > 3 && (
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-secondary/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700 text-xs uppercase">Rank</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700 text-xs uppercase">Member</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700 text-xs uppercase">Code</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700 text-xs uppercase">Referrals</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700 text-xs uppercase">Earned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.leaders.slice(3).map((l, i) => (
                    <tr key={l.user_id} className={l.user_id === user?.id ? "bg-amber-50" : "hover:bg-secondary/30"} data-testid={`lb-row-${i + 4}`}>
                      <td className="px-3 py-2 font-display font-black text-slate-500">#{i + 4}</td>
                      <td className="px-3 py-2 font-semibold text-emerald-950">{l.name}{l.user_id === user?.id && <span className="ml-2 text-[10px] font-bold bg-amber-400 text-emerald-950 px-2 py-0.5 rounded-full">YOU</span>}</td>
                      <td className="px-3 py-2 text-xs text-slate-500 font-mono">{l.member_code}</td>
                      <td className="px-3 py-2 text-right font-display font-black text-emerald-900">{l.referral_count}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-800">{inr(l.total_bonus_earned)}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RankUpCelebrations({ items, currentUserId }) {
  if (!items || items.length === 0) return null;
  const hero = items[0];
  const rest = items.slice(1);
  return (
    <section className="space-y-4" data-testid="rank-up-feed">
      <div className="flex items-center gap-2">
        <PartyPopper className="w-5 h-5 text-amber-500" />
        <h2 className="font-display font-black text-xl text-emerald-950">Recent Rank-Ups</h2>
        <span className="text-[10px] uppercase tracking-widest text-amber-700 font-bold bg-amber-100 px-2 py-0.5 rounded-full">Celebrations</span>
      </div>

      {/* Hero card — latest promotion, big & flashy */}
      <div className={`relative overflow-hidden rounded-2xl p-6 md:p-7 text-white shadow-xl bg-gradient-to-br ${RANK_GRADIENTS[hero.to_rank] || RANK_GRADIENTS.Starter}`} data-testid="rank-up-hero">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 20% 30%, white 2px, transparent 2px), radial-gradient(circle at 80% 60%, white 2px, transparent 2px), radial-gradient(circle at 60% 20%, white 2px, transparent 2px)", backgroundSize: "80px 80px" }} />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="text-6xl md:text-7xl leading-none drop-shadow-lg">{RANK_EMOJI[hero.to_rank] || "⭐"}</div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/80">Rank-Up Unlocked · {timeAgo(hero.created_at)}</p>
            <p className="font-display font-black text-2xl md:text-3xl mt-1">
              {hero.user_name}
              {hero.user_id === currentUserId && <span className="ml-2 text-[10px] font-bold bg-white text-emerald-950 px-2 py-0.5 rounded-full align-middle">YOU</span>}
            </p>
            <p className="text-white/90 text-sm mt-1">
              <span className="font-semibold">{hero.member_code}</span> just leveled up
            </p>
            <div className="mt-3 inline-flex items-center gap-3 bg-white/15 backdrop-blur border border-white/30 rounded-full px-4 py-2">
              <span className="text-xs font-bold uppercase tracking-widest">{hero.from_rank}</span>
              <ArrowUp className="w-4 h-4 rotate-45" />
              <span className="text-sm font-black uppercase tracking-widest">{hero.to_rank}</span>
            </div>
          </div>
          <Sparkles className="hidden md:block w-10 h-10 text-white/60" />
        </div>
      </div>

      {/* Rest of celebrations — compact grid */}
      {rest.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {rest.map(ev => (
            <div key={ev.id} className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 hover:shadow-md transition-shadow" data-testid={`rank-up-${ev.id}`}>
              <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${RANK_GRADIENTS[ev.to_rank] || RANK_GRADIENTS.Starter} flex items-center justify-center text-2xl shrink-0 shadow`}>
                {RANK_EMOJI[ev.to_rank] || "⭐"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{ev.member_code} · {timeAgo(ev.created_at)}</p>
                <p className="font-display font-bold text-emerald-950 text-sm truncate">
                  {ev.user_name}
                  {ev.user_id === currentUserId && <span className="ml-1 text-[9px] font-bold bg-amber-400 text-emerald-950 px-1.5 py-0.5 rounded-full align-middle">YOU</span>}
                </p>
                <div className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-semibold">
                  <span className={`px-1.5 py-0.5 rounded ${RANK_COLORS[ev.from_rank] || RANK_COLORS.Starter}`}>{ev.from_rank}</span>
                  <ArrowUp className="w-2.5 h-2.5 rotate-45 text-emerald-700" />
                  <span className={`px-1.5 py-0.5 rounded font-bold ${RANK_COLORS[ev.to_rank] || RANK_COLORS.Starter}`}>{ev.to_rank}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}


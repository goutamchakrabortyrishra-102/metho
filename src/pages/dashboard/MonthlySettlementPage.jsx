import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Calculator, Play, CheckCircle2, Lock, TrendingUp, Users, Award, Shield, RefreshCw, History, FileSpreadsheet } from "lucide-react";
import { Navigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const StatCard = ({ icon: Icon, label, value, hint, tone = "emerald" }) => (
  <div className="bg-white rounded-xl border border-border p-5">
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tone === "amber" ? "bg-amber-100" : "bg-emerald-100"}`}>
        <Icon className={`w-5 h-5 ${tone === "amber" ? "text-amber-700" : "text-emerald-800"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</p>
        <p className="font-display font-black text-xl text-emerald-950 mt-0.5 truncate">{value}</p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  </div>
);

export default function MonthlySettlementPage() {
  const { user } = useAuth();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [preview, setPreview] = useState(null);
  const [mps, setMps] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);

  const period = `${year}-${String(month).padStart(2, "0")}`;

  const exportExcel = () => {
    if (!preview) return toast.error("No data to export");
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    const p = preview.pool_snapshot;
    const ms = preview.member_settlement;
    const ls = preview.leader_settlement;
    const summaryRows = [
      ["METHOO STORE — Monthly Settlement Report", ""],
      ["Period", preview.period],
      ["Status", preview.already_settled ? "Settled" : "Preview (not yet executed)"],
      ["Generated at", new Date().toLocaleString()],
      [],
      ["POOL SNAPSHOT", "AMOUNT (₹)"],
      ["Gross Sales", p.gross_sales],
      ["Commission Collected", p.commission_collected],
      ["Member Reward Pool", p.member_pool],
      ["Leader Reward Pool", p.leader_pool],
      ["MPS Fund Contribution", p.mps_fund_contribution],
      ["Company Fund", p.company_fund],
      ["Technology Reserve", p.technology_reserve],
      [],
      ["MEMBER SETTLEMENT", ""],
      ["Total Points", ms.total_points],
      ["Point Value (₹)", ms.point_value],
      ["Total Reward Distributed (₹)", ms.total_reward_distributed],
      ["Total Members", ms.lines.length],
      [],
      ["LEADER SETTLEMENT", ""],
      ["Qualified Leaders", ls.qualified_count],
      ["Total Leader Points", ls.total_points],
      ["Leader Point Value (₹)", ls.point_value],
      ["Total Leader Reward (₹)", ls.total_reward_distributed],
    ];
    const s1 = XLSX.utils.aoa_to_sheet(summaryRows);
    s1["!cols"] = [{ wch: 35 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, s1, "Summary");

    // Sheet 2: Member Payouts
    if (ms.lines.length > 0) {
      const memberRows = [
        ["Member Code", "Member Name", "Monthly Purchase (₹)", "Points", "Point Value (₹)", "Reward (₹)"],
        ...ms.lines.map((l) => [
          l.member_code || "", l.user_name || "",
          l.monthly_purchase, l.points, ms.point_value, l.reward,
        ]),
        [],
        ["TOTAL", "", ms.lines.reduce((s, l) => s + (l.monthly_purchase || 0), 0), ms.total_points, "", ms.total_reward_distributed],
      ];
      const s2 = XLSX.utils.aoa_to_sheet(memberRows);
      s2["!cols"] = [{ wch: 15 }, { wch: 30 }, { wch: 22 }, { wch: 12 }, { wch: 18 }, { wch: 15 }];
      XLSX.utils.book_append_sheet(wb, s2, "Member Payouts");
    }

    // Sheet 3: Leader Payouts
    if (ls.lines.length > 0) {
      const leaderRows = [
        ["Member Code", "Leader Name", "Tier", "Monthly Purchase (₹)", "Points", "Point Value (₹)", "Reward (₹)"],
        ...ls.lines.map((l) => [
          l.member_code || "", l.user_name || "", l.tier_label || "Leader",
          l.monthly_purchase, l.points, l.point_value ?? ls.point_value, l.reward,
        ]),
        [],
        ["TOTAL", "", "", ls.lines.reduce((s, l) => s + (l.monthly_purchase || 0), 0), ls.total_points, "", ls.total_reward_distributed],
      ];
      const s3 = XLSX.utils.aoa_to_sheet(leaderRows);
      s3["!cols"] = [{ wch: 15 }, { wch: 30 }, { wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 18 }, { wch: 15 }];
      XLSX.utils.book_append_sheet(wb, s3, "Leader Payouts");
    }

    // Sheet 4: Leader Eligibility Detail (why some qualified / others didn't)
    if (ls.lines.length > 0) {
      const eligRows = [["Member Code", "Leader Name", "Direct Members", "Personal Purchase (₹)", "Team Purchase (₹)", "Active Members", "Account Days"]];
      ls.lines.forEach((l) => {
        const c = l.eligibility || {};
        eligRows.push([
          l.member_code || "", l.user_name || "",
          `${c.direct_members?.actual}/${c.direct_members?.required}`,
          `${c.personal_monthly_purchase?.actual}/${c.personal_monthly_purchase?.required}`,
          `${c.team_monthly_purchase?.actual}/${c.team_monthly_purchase?.required}`,
          `${c.active_members?.actual}/${c.active_members?.required}`,
          `${c.account_days?.actual}/${c.account_days?.required}`,
        ]);
      });
      const s4 = XLSX.utils.aoa_to_sheet(eligRows);
      s4["!cols"] = [{ wch: 15 }, { wch: 30 }, { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 18 }, { wch: 15 }];
      XLSX.utils.book_append_sheet(wb, s4, "Leader Eligibility");
    }

    const filename = `METHO_Settlement_${preview.period}${preview.already_settled ? "" : "_PREVIEW"}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast.success(`Exported: ${filename}`);
  };

  const loadAll = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const [p, m, h] = await Promise.all([
        api.get(`/admin/settlement/preview?year=${year}&month=${month}`),
        api.get("/admin/mps-fund"),
        api.get("/admin/settlements"),
      ]);
      setPreview(p.data);
      setMps(m.data);
      setHistory(h.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [year, month]);

  if (!isAdmin) return <Navigate to="/app" replace />;

  const execute = async () => {
    if (!preview || preview.already_settled) return;
    const memberTotal = preview.member_settlement.total_reward_distributed;
    const leaderTotal = preview.leader_settlement.total_reward_distributed;
    if (!window.confirm(
      `Settle ${period}?\n\nMembers: ${inr(memberTotal)} to ${preview.member_settlement.lines.length} people\nLeaders: ${inr(leaderTotal)} to ${preview.leader_settlement.qualified_count} qualified\n\nThis is IRREVERSIBLE.`
    )) return;
    setExecuting(true);
    try {
      const { data } = await api.post(`/admin/settlement/execute?year=${year}&month=${month}`);
      toast.success(`Settlement complete! Members: ${inr(memberTotal)} + Leaders: ${inr(leaderTotal)}`, { duration: 6000 });
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Settlement failed");
    } finally {
      setExecuting(false);
    }
  };

  const p = preview?.pool_snapshot;
  const ms = preview?.member_settlement;
  const ls = preview?.leader_settlement;

  return (
    <div className="space-y-6" data-testid="monthly-settlement-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin · Settlement Engine</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Monthly Settlement</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">
            Member Reward = Purchase Points × Point Value · All rules read from Admin Settings.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label>Year</Label>
            <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-10 w-24" data-testid="settle-year-input" />
          </div>
          <div>
            <Label>Month</Label>
            <Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-10 w-20" data-testid="settle-month-input" />
          </div>
          <Button variant="outline" onClick={loadAll} disabled={loading} className="h-10 rounded-full">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="outline"
            onClick={exportExcel}
            disabled={!preview}
            className="h-10 rounded-full border-emerald-800 text-emerald-900 hover:bg-emerald-50"
            data-testid="export-excel-button"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Export Excel
          </Button>
        </div>
      </div>

      {/* MPS Fund Card */}
      {mps && (
        <div className="rounded-xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950 text-white p-6 relative overflow-hidden" data-testid="mps-summary">
          <div className="absolute inset-0 grain opacity-25" />
          <div className="relative flex flex-wrap gap-6 items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-400 text-emerald-950 flex items-center justify-center">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-bold">MPS Shield Fund</p>
                <p className="font-display font-black text-4xl mt-1">{inr(mps.balance)}</p>
                <p className="text-xs text-emerald-100/70 mt-1">Contributions {inr(mps.total_contributions)} · Claims paid {inr(mps.total_approved_claims)}</p>
              </div>
            </div>
            <div className="text-right text-xs text-emerald-100/80">
              <p className="uppercase tracking-widest font-semibold text-amber-400/80">Rules (admin-configured)</p>
              <p>Max claim: {inr(mps.rules.mps_max_claim_amount)}</p>
              <p>Min active months: {mps.rules.mps_min_active_months}</p>
              <p>Claim gap: {mps.rules.mps_min_claim_gap_days} days</p>
            </div>
          </div>
        </div>
      )}

      {/* Pool Snapshot */}
      {p && (
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-2">Period {period} · Pool Snapshot</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard icon={Users} label="Member Pool" value={inr(p.member_pool)} tone="emerald" />
            <StatCard icon={Award} label="Leader Pool" value={inr(p.leader_pool)} tone="amber" />
            <StatCard icon={Shield} label="MPS Contribution" value={inr(p.mps_fund_contribution)} tone="emerald" />
            <StatCard icon={TrendingUp} label="Company Fund" value={inr(p.company_fund)} tone="amber" />
            <StatCard icon={Calculator} label="Tech Reserve" value={inr(p.technology_reserve)} tone="emerald" />
          </div>
          <p className="text-xs text-muted-foreground mt-2 font-body">
            Gross sales <span className="font-semibold text-emerald-900">{inr(p.gross_sales)}</span> ·
            Commission collected <span className="font-semibold text-emerald-900">{inr(p.commission_collected)}</span>
          </p>
        </div>
      )}

      {/* Member Settlement */}
      {ms && (
        <div className="bg-white rounded-xl border border-border p-6" data-testid="member-settlement">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display font-bold text-emerald-950 text-lg">Member Settlement</h3>
              <p className="text-xs text-muted-foreground font-body">Formula: Reward = Points × Point Value · ₹100 purchase = 1 point</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider">Point Value this month</p>
              <p className="font-display font-black text-3xl text-emerald-800">₹{ms.point_value.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-emerald-50 p-3 border border-emerald-200">
              <p className="text-[10px] uppercase text-emerald-800 font-bold tracking-wider">Total Points</p>
              <p className="font-display font-black text-xl text-emerald-950">{ms.total_points.toLocaleString("en-IN")}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-3 border border-amber-200">
              <p className="text-[10px] uppercase text-amber-800 font-bold tracking-wider">Members</p>
              <p className="font-display font-black text-xl text-emerald-950">{ms.lines.length}</p>
            </div>
            <div className="rounded-lg bg-emerald-900 p-3 text-white">
              <p className="text-[10px] uppercase text-amber-400 font-bold tracking-wider">Total Reward</p>
              <p className="font-display font-black text-xl">{inr(ms.total_reward_distributed)}</p>
            </div>
          </div>
          {ms.lines.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-slate-700">Member</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-700">Purchase</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-700">Points</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-700">Reward</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ms.lines.slice(0, 20).map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-emerald-950">{l.user_name || "—"}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{l.member_code}</p>
                      </td>
                      <td className="text-right px-3 py-2">{inr(l.monthly_purchase)}</td>
                      <td className="text-right px-3 py-2 font-mono">{l.points}</td>
                      <td className="text-right px-3 py-2 font-bold text-emerald-800">{inr(l.reward)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ms.lines.length > 20 && <p className="text-xs text-muted-foreground mt-2">Showing 20 of {ms.lines.length}</p>}
            </div>
          )}
        </div>
      )}

      {/* Leader Settlement */}
      {ls && (
        <div className="bg-white rounded-xl border border-border p-6" data-testid="leader-settlement">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display font-bold text-emerald-950 text-lg">Leader Settlement</h3>
              <p className="text-xs text-muted-foreground font-body">Eligibility rules from Settings · qualified leaders only</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider">Leader Point Value</p>
              <p className="font-display font-black text-3xl text-amber-700">₹{ls.point_value.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-amber-50 p-3 border border-amber-200">
              <p className="text-[10px] uppercase text-amber-800 font-bold tracking-wider">Qualified Leaders</p>
              <p className="font-display font-black text-xl text-emerald-950">{ls.qualified_count}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3 border border-emerald-200">
              <p className="text-[10px] uppercase text-emerald-800 font-bold tracking-wider">Total Leader Points</p>
              <p className="font-display font-black text-xl text-emerald-950">{ls.total_points.toLocaleString("en-IN")}</p>
            </div>
            <div className="rounded-lg bg-emerald-900 p-3 text-white">
              <p className="text-[10px] uppercase text-amber-400 font-bold tracking-wider">Total Reward</p>
              <p className="font-display font-black text-xl">{inr(ls.total_reward_distributed)}</p>
            </div>
          </div>
          {ls.tiers && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4" data-testid="leader-tier-breakdown">
              <p className="text-[11px] uppercase tracking-widest text-amber-800 font-semibold">50 / 30 / 20 Tier Split Breakdown</p>
              {ls.tier_eligibility && (
                <p className="text-xs text-amber-900 mt-1">
                  Eligibility mapping: Leader ({ls.tier_eligibility.leader || "starter,bronze"}) · Elite ({ls.tier_eligibility.elite_leader || "silver,gold"}) · Crown ({ls.tier_eligibility.crown_leader || "diamond"})
                </p>
              )}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-amber-100/70">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-amber-900">Tier</th>
                      <th className="text-right px-3 py-2 font-semibold text-amber-900">Pool %</th>
                      <th className="text-right px-3 py-2 font-semibold text-amber-900">Pool Amount</th>
                      <th className="text-right px-3 py-2 font-semibold text-amber-900">Points</th>
                      <th className="text-right px-3 py-2 font-semibold text-amber-900">Point Value</th>
                      <th className="text-right px-3 py-2 font-semibold text-amber-900">Qualified</th>
                      <th className="text-right px-3 py-2 font-semibold text-amber-900">Reward</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-200/70">
                    {Object.entries(ls.tiers).map(([key, tier]) => (
                      <tr key={key}>
                        <td className="px-3 py-2 font-semibold text-emerald-950">{tier.label}</td>
                        <td className="text-right px-3 py-2">{Number(tier.pool_percent || 0).toFixed(2)}%</td>
                        <td className="text-right px-3 py-2">{inr(tier.pool_amount)}</td>
                        <td className="text-right px-3 py-2 font-mono">{Number(tier.total_points || 0).toLocaleString("en-IN")}</td>
                        <td className="text-right px-3 py-2 font-semibold text-amber-800">₹{Number(tier.point_value || 0).toFixed(2)}</td>
                        <td className="text-right px-3 py-2">{Number(tier.qualified_count || 0)}</td>
                        <td className="text-right px-3 py-2 font-bold text-emerald-800">{inr(tier.total_reward_distributed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {ls.lines.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground italic">No leaders qualified this period based on current Admin rules.</p>
          )}
        </div>
      )}

      {/* Execute Button */}
      {preview && (
        preview.already_settled ? (
          <div className="rounded-xl bg-emerald-50 border-2 border-emerald-300 p-6 flex items-center gap-4" data-testid="already-settled-banner">
            <CheckCircle2 className="w-8 h-8 text-emerald-700" />
            <div className="flex-1">
              <h4 className="font-display font-bold text-emerald-900">Already Settled</h4>
              <p className="text-sm text-emerald-800">Period {period} was previously settled. See history below.</p>
            </div>
            <Lock className="w-5 h-5 text-emerald-700" />
          </div>
        ) : (
          <div className="rounded-xl bg-gradient-to-r from-amber-50 to-emerald-50 border-2 border-amber-300 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h4 className="font-display font-bold text-emerald-950">Ready to settle {period}</h4>
                <p className="text-sm text-slate-700 mt-1">
                  {inr((ms?.total_reward_distributed || 0) + (ls?.total_reward_distributed || 0))} will be credited to {(ms?.lines?.length || 0) + (ls?.qualified_count || 0)} wallets. This is <span className="font-bold text-red-700">irreversible</span>.
                </p>
              </div>
              <Button onClick={execute} disabled={executing} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full h-12 px-8 font-bold text-base" data-testid="execute-settlement-button">
                <Play className="w-4 h-4 mr-2" />
                {executing ? "Settling..." : "Execute Settlement"}
              </Button>
            </div>
          </div>
        )
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-6" data-testid="settlement-history">
          <div className="flex items-center gap-2 mb-4">
            <History className="w-4 h-4 text-emerald-700" />
            <h3 className="font-display font-bold text-emerald-950">Settlement History</h3>
          </div>
          <div className="divide-y divide-border">
            {history.map((s) => (
              <div key={s.id} className="py-3 flex flex-wrap justify-between gap-3 items-center">
                <div>
                  <p className="font-display font-bold text-emerald-950">{s.period}</p>
                  <p className="text-xs text-muted-foreground">Settled at {new Date(s.settled_at).toLocaleString()} by {s.settled_by_name}</p>
                </div>
                <div className="flex gap-4 text-sm">
                  <div><span className="text-muted-foreground">Members:</span> <span className="font-bold text-emerald-800">{inr(s.member_settlement.total_reward_distributed)}</span></div>
                  <div><span className="text-muted-foreground">Leaders:</span> <span className="font-bold text-amber-700">{inr(s.leader_settlement.total_reward_distributed)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Printer, ArrowLeft, FileText } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { getWithdrawalBreakdown, resolveWithdrawalDeductionRates } from "@/lib/withdrawal";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function WalletStatementPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [txs, setTxs] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [deductionRates, setDeductionRates] = useState(resolveWithdrawalDeductionRates());

  useEffect(() => {
    api.get("/wallet").then(r => setWallet(r.data));
    api.get("/wallet/transactions").then(r => setTxs(r.data));
    api.get("/wallet/withdrawals").then(r => setWithdrawals(Array.isArray(r.data) ? r.data : [])).catch(() => setWithdrawals([]));
    api.get("/settings")
      .then((r) => setDeductionRates(resolveWithdrawalDeductionRates(r.data || {})))
      .catch(() => setDeductionRates(resolveWithdrawalDeductionRates()));
  }, []);

  if (!wallet) return <div className="p-8 text-center">Loading...</div>;

  const inflow = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const outflow = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const mpsPayouts = txs.filter(t => t.type === "mps_claim_payout").reduce((s, t) => s + (t.amount || 0), 0);
  const withdrawalSummary = withdrawals.reduce((acc, w) => {
    const b = getWithdrawalBreakdown(w, deductionRates);
    acc.gross += b.grossAmount;
    acc.tds += b.tdsAmount;
    acc.admin += b.adminChargeAmount;
    acc.net += b.netAmount;
    return acc;
  }, { gross: 0, tds: 0, admin: 0, net: 0 });

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0" data-testid="wallet-statement-page">
      <div className="max-w-4xl mx-auto px-4 flex items-center justify-between mb-4 print:hidden">
        <Link to="/app/wallet" className="inline-flex items-center gap-2 text-emerald-900 hover:underline font-semibold text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Wallet
        </Link>
        <Button onClick={() => window.print()} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="print-statement-button">
          <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
        </Button>
      </div>

      <div className="max-w-4xl mx-auto bg-white shadow-lg print:shadow-none border border-slate-200 print:border-0" id="statement-print">
        <div className="border-b-4 border-emerald-900 px-8 py-6 bg-gradient-to-br from-emerald-50/40 to-white flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-amber-600 font-bold">Wallet Statement</p>
            <h1 className="font-display font-black text-3xl text-emerald-950 mt-1">METHOO STORE</h1>
            <p className="text-xs text-slate-600 font-body mt-1">METHOO STORE, India</p>
          </div>
          <div className="text-right">
            <div className="inline-flex items-center gap-1 text-emerald-900 font-bold text-lg font-display"><FileText className="w-5 h-5" /> STATEMENT</div>
            <p className="mt-2 text-xs text-slate-500 uppercase tracking-wider font-semibold">Account</p>
            <p className="font-mono font-bold text-emerald-950">{user?.member_code}</p>
            <p className="mt-1 text-xs text-slate-500 uppercase tracking-wider font-semibold">Generated</p>
            <p className="text-sm font-semibold text-emerald-950">{new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
          </div>
        </div>

        <div className="px-8 py-5 border-b border-slate-200">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Account Holder</p>
          <p className="font-display font-bold text-emerald-950 mt-1">{user?.name}</p>
          <p className="text-xs text-slate-600 font-body">{user?.email} · {user?.phone}</p>
        </div>

        <div className="px-8 py-5 grid grid-cols-4 gap-4 border-b border-slate-200 bg-slate-50/40">
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">Available Balance</p><p className="font-display font-black text-xl text-emerald-800">{inr(wallet.balance)}</p></div>
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">Total Income</p><p className="font-display font-black text-xl text-emerald-950">{inr(wallet.total_income)}</p></div>
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">Total Bonus</p><p className="font-display font-black text-xl text-emerald-950">{inr(wallet.total_bonus)}</p></div>
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">Withdrawn</p><p className="font-display font-black text-xl text-slate-600">{inr(wallet.total_withdrawn)}</p></div>
        </div>

        <div className="px-8 py-5 grid grid-cols-3 gap-4 border-b border-slate-200">
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">Member Reward (settled)</p><p className="font-display font-black text-lg text-emerald-800">{inr(wallet.member_reward_credited)}</p></div>
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">Leader Reward (settled)</p><p className="font-display font-black text-lg text-amber-700">{inr(wallet.leader_reward_credited)}</p></div>
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">MPS Payouts</p><p className="font-display font-black text-lg text-slate-700">{inr(mpsPayouts)}</p></div>
        </div>

        <div className="px-8 py-5 grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-slate-200 bg-amber-50/50">
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">Withdraw Gross</p><p className="font-display font-black text-lg text-emerald-950">{inr(withdrawalSummary.gross)}</p></div>
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">TDS ({deductionRates.tdsPercent}%)</p><p className="font-display font-black text-lg text-red-700">-{inr(withdrawalSummary.tds)}</p></div>
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">Admin Charge ({deductionRates.adminChargePercent}%)</p><p className="font-display font-black text-lg text-red-700">-{inr(withdrawalSummary.admin)}</p></div>
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">Net Payout</p><p className="font-display font-black text-lg text-emerald-800">{inr(withdrawalSummary.net)}</p></div>
        </div>

        <div className="px-8 py-5">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Transaction History</p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-emerald-900 text-white">
                <th className="text-left px-3 py-2 text-xs uppercase tracking-wider">Date</th>
                <th className="text-left px-3 py-2 text-xs uppercase tracking-wider">Type</th>
                <th className="text-left px-3 py-2 text-xs uppercase tracking-wider">Description</th>
                <th className="text-right px-3 py-2 text-xs uppercase tracking-wider">Amount</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((t, i) => (
                <tr key={i} className={i % 2 ? "bg-slate-50" : ""}>
                  <td className="px-3 py-2 text-xs">{new Date(t.created_at).toLocaleDateString("en-IN")}</td>
                  <td className="px-3 py-2 text-xs capitalize">{(t.type || "").replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 text-xs">{t.description}</td>
                  <td className={`text-right px-3 py-2 font-semibold ${t.amount > 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {t.amount > 0 ? "+" : ""}{inr(t.amount)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-emerald-900 font-bold">
                <td colSpan="2" className="px-3 py-2 text-right">Total Inflow</td>
                <td className="px-3 py-2 text-emerald-700">{inr(inflow)}</td>
                <td className="text-right px-3 py-2 text-red-700">-{inr(outflow)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="px-8 py-4 border-t border-slate-200 text-[10px] text-slate-500 italic bg-slate-50/70">
          This is a system-generated statement. For any discrepancy, contact billing@metho.com within 30 days.
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          #statement-print { box-shadow: none !important; border: none !important; }
        }
      `}</style>
    </div>
  );
}


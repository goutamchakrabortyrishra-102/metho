import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wallet as WalletIcon, ArrowDown, ArrowUp, Users, Award, Shield, FileDown } from "lucide-react";
import { Link } from "react-router-dom";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import MonthlyProjectionCard from "@/components/MonthlyProjectionCard";
import { getWithdrawalBreakdown, resolveWithdrawalDeductionRates } from "@/lib/withdrawal";

const inr = (v) => `Rs ${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function WalletPage() {
  const BACKEND = String(api?.defaults?.baseURL || "").replace(/\/?api\/?$/, "");
  const [wallet, setWallet] = useState(null);
  const [txs, setTxs] = useState([]);
  const [wds, setWds] = useState([]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("upi");
  const [account, setAccount] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deductionRates, setDeductionRates] = useState(resolveWithdrawalDeductionRates());

  const load = () => {
    api.get("/wallet").then(r => setWallet(r.data));
    api.get("/wallet/transactions").then(r => setTxs(r.data));
    api.get("/wallet/withdrawals").then(r => setWds(r.data));
    api.get("/settings")
      .then((r) => setDeductionRates(resolveWithdrawalDeductionRates(r.data || {})))
      .catch(() => setDeductionRates(resolveWithdrawalDeductionRates()));
  };

  useEffect(() => { load(); }, []);

  const requestedAmount = Number(amount || 0);
  const requestPreview = getWithdrawalBreakdown({ amount: requestedAmount }, deductionRates);

  const withdraw = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/wallet/withdraw", { amount: parseFloat(amount), method, account_details: account });
      toast.success("Withdrawal request submitted!");
      setOpen(false);
      setAmount(""); setAccount("");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Withdrawal failed");
    } finally {
      setLoading(false);
    }
  };

  if (!wallet) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6" data-testid="wallet-page">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Wallet</p>
        <div className="flex flex-wrap justify-between items-end gap-3">
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Your Money. Your Way.</h1>
          <Link to="/wallet-statement" target="_blank">
            <Button variant="outline" className="rounded-full border-emerald-800 text-emerald-900 hover:bg-emerald-50" data-testid="download-statement-button">
              <FileDown className="w-4 h-4 mr-2" /> View Statement
            </Button>
          </Link>
          <Button
            variant="outline"
            className="rounded-full border-emerald-800 text-emerald-900 hover:bg-emerald-50"
            data-testid="download-statement-pdf-button"
            onClick={async () => {
              try {
                const token = localStorage.getItem("metho_token");
                const res = await fetch(`${BACKEND}/api/wallet/statement/pdf`, { headers: { Authorization: `Bearer ${token}` } });
                if (!res.ok) throw new Error("Failed");
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "Wallet_Statement.pdf";
                a.click();
                URL.revokeObjectURL(url);
                toast.success("PDF downloaded");
              } catch { toast.error("PDF download failed"); }
            }}
          >
            <FileDown className="w-4 h-4 mr-2" /> Download PDF
          </Button>
        </div>
      </div>

      <MonthlyProjectionCard />

      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-gradient-to-br from-emerald-900 to-emerald-950 text-white rounded-2xl p-8 relative overflow-hidden">
          <div className="absolute inset-0 grain opacity-20" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <WalletIcon className="w-8 h-8 text-amber-400" />
              <span className="text-xs bg-amber-400/20 text-amber-400 px-2 py-1 rounded-full font-semibold">Active</span>
            </div>
            <p className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold mt-6">Available Balance</p>
            <p className="font-display font-black text-5xl md:text-6xl mt-2 tracking-tighter" data-testid="wallet-balance">
              ₹{wallet.balance?.toLocaleString("en-IN")}
            </p>
            <div className="mt-8 flex flex-wrap gap-6 pt-6 border-t border-emerald-800">
              <div>
                <p className="text-[10px] uppercase tracking-[0.15em] text-emerald-100/60 font-semibold">Total Income</p>
                <p className="font-display font-bold text-xl">₹{wallet.total_income?.toLocaleString("en-IN")}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.15em] text-emerald-100/60 font-semibold">Total Bonus</p>
                <p className="font-display font-bold text-xl">₹{wallet.total_bonus?.toLocaleString("en-IN")}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.15em] text-emerald-100/60 font-semibold">Withdrawn</p>
                <p className="font-display font-bold text-xl">₹{wallet.total_withdrawn?.toLocaleString("en-IN")}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-border p-6 flex flex-col justify-between">
          <div>
            <h3 className="font-display font-bold text-emerald-950">Quick Actions</h3>
            <p className="text-sm text-muted-foreground font-body mt-1">Withdraw to UPI, IMPS or Bank</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="mt-4 w-full h-12 bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="withdraw-button">
                <ArrowDown className="w-4 h-4 mr-2" /> Withdraw Funds
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Request Withdrawal</DialogTitle>
                <DialogDescription>Submit your payout request by choosing a method and entering account details.</DialogDescription>
              </DialogHeader>
              <form onSubmit={withdraw} className="space-y-4" data-testid="withdraw-form">
                <div>
                  <Label>Amount (₹)</Label>
                  <Input type="number" min="100" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="Min ₹100" data-testid="withdraw-amount-input" />
                </div>
                {requestedAmount > 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs" data-testid="withdraw-preview-breakdown">
                    <p className="font-semibold text-amber-900">Estimated deduction breakdown</p>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-amber-900/90">
                      <span>Gross</span>
                      <span className="text-right font-semibold">{inr(requestPreview.grossAmount)}</span>
                      <span>TDS ({requestPreview.tdsPercent}%)</span>
                      <span className="text-right">-{inr(requestPreview.tdsAmount)}</span>
                      <span>Admin Charge ({requestPreview.adminChargePercent}%)</span>
                      <span className="text-right">-{inr(requestPreview.adminChargeAmount)}</span>
                      <span className="font-semibold">Net Payout</span>
                      <span className="text-right font-semibold">{inr(requestPreview.netAmount)}</span>
                    </div>
                  </div>
                ) : null}
                <div>
                  <Label>Method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger data-testid="withdraw-method-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="imps">IMPS</SelectItem>
                      <SelectItem value="bank">Bank Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Account Number / Details</Label>
                  <Input required value={account} onChange={e => setAccount(e.target.value)} placeholder="01XXXXXXXXX or bank account" data-testid="withdraw-account-input" />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={loading} className="bg-emerald-900 hover:bg-emerald-950" data-testid="withdraw-submit-button">
                    {loading ? "Processing..." : "Submit Request"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Reward source breakdown — where money came from */}
      <div>
        <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-2">Reward Source Breakdown</p>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-border p-5" data-testid="wallet-member-reward">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center"><Users className="w-4.5 h-4.5 text-emerald-800" /></div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mt-3">Member Reward Settled</p>
            <p className="font-display font-black text-2xl text-emerald-950 mt-1">₹{Number(wallet.member_reward_credited || 0).toLocaleString("en-IN")}</p>
            <p className="text-xs text-muted-foreground mt-1">Monthly settlement payouts</p>
          </div>
          <div className="bg-white rounded-xl border border-border p-5" data-testid="wallet-leader-reward">
            <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center"><Award className="w-4.5 h-4.5 text-amber-700" /></div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mt-3">Leader Reward Settled</p>
            <p className="font-display font-black text-2xl text-emerald-950 mt-1">₹{Number(wallet.leader_reward_credited || 0).toLocaleString("en-IN")}</p>
            <p className="text-xs text-muted-foreground mt-1">Qualified leader bonuses</p>
          </div>
          <div className="bg-white rounded-xl border border-border p-5" data-testid="wallet-mps-payout">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center"><Shield className="w-4.5 h-4.5 text-slate-800" /></div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mt-3">MPS Fund Payouts</p>
            <p className="font-display font-black text-2xl text-emerald-950 mt-1">₹{txs.filter(t => t.type === "mps_claim_payout").reduce((s, t) => s + (t.amount || 0), 0).toLocaleString("en-IN")}</p>
            <p className="text-xs text-muted-foreground mt-1">Approved claim credits</p>
          </div>
        </div>
      </div>

      {/* Reward Points & MPS Shield */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-border p-5" data-testid="wallet-mvr">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
            <span className="font-black text-emerald-800 text-sm">MVR</span>
          </div>
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mt-3">Member Value Reward™</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">{Number(wallet.member_value_points || 0).toLocaleString("en-IN")}</p>
          <p className="text-xs text-muted-foreground mt-1">Points earned on all purchases</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-5" data-testid="wallet-elr">
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
            <span className="font-black text-amber-800 text-sm">ELR</span>
          </div>
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mt-3">Elite Leader Reward™</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">{Number(wallet.elite_leader_points || 0).toLocaleString("en-IN")}</p>
          <p className="text-xs text-muted-foreground mt-1">Points from your downline's orders</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-5" data-testid="wallet-mps">
          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
            <span className="font-black text-slate-800 text-sm">MPS</span>
          </div>
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mt-3">MPS Shield™ Fund</p>
          <p className="font-display font-black text-2xl text-emerald-950 mt-1">₹{Number(wallet.mps_shield_balance || 0).toLocaleString("en-IN")}</p>
          <p className="text-xs text-muted-foreground mt-1">Your safety-net contribution</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-border p-5">
          <h3 className="font-display font-bold text-emerald-950 mb-4">Transaction Ledger</h3>
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {txs.length === 0 && <p className="text-sm text-muted-foreground py-4">No transactions yet.</p>}
            {txs.map((t, i) => (
              <div key={i} className="py-3 flex items-center justify-between" data-testid={`tx-row-${i}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${t.amount > 0 ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                    {t.amount > 0 ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="font-semibold text-emerald-950 text-sm">{t.description}</p>
                    <p className="text-xs text-muted-foreground capitalize">{t.type?.replace("_", " ")}</p>
                  </div>
                </div>
                <p className={`font-display font-bold ${t.amount > 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {t.amount > 0 ? "+" : ""}₹{Math.abs(t.amount).toLocaleString("en-IN")}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-5">
          <h3 className="font-display font-bold text-emerald-950 mb-4">Withdrawal History</h3>
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {wds.length === 0 && <p className="text-sm text-muted-foreground py-4">No withdrawals yet.</p>}
            {wds.map((w, i) => (
              <div key={i} className="py-3 flex items-center justify-between" data-testid={`wd-row-${i}`}>
                <div>
                  {(() => {
                    const breakdown = getWithdrawalBreakdown(w, deductionRates);
                    return (
                      <>
                        <p className="font-semibold text-emerald-950 text-sm">Gross: {inr(breakdown.grossAmount)}</p>
                        <p className="text-[11px] text-slate-600">
                          TDS: {inr(breakdown.tdsAmount)} | Admin: {inr(breakdown.adminChargeAmount)} | Net: {inr(breakdown.netAmount)}
                        </p>
                      </>
                    );
                  })()}
                  <p className="text-xs text-muted-foreground capitalize">{w.method} · {w.account_details}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                  w.status === "approved" ? "bg-emerald-100 text-emerald-800" :
                  w.status === "rejected" ? "bg-red-100 text-red-800" :
                  "bg-amber-100 text-amber-800"
                }`}>{w.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import { BadgeIndianRupee, CheckCircle2, XCircle, Filter, Copy, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { getWithdrawalBreakdown, resolveWithdrawalDeductionRates } from "@/lib/withdrawal";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const STATUS_STYLES = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

export default function WithdrawalsPage() {
  const { user } = useAuth();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [approveItem, setApproveItem] = useState(null);
  const [rejectItem, setRejectItem] = useState(null);
  const [utr, setUtr] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [deductionRates, setDeductionRates] = useState(resolveWithdrawalDeductionRates());

  const load = () => {
    api.get(`/admin/withdrawals${statusFilter ? `?status_filter=${statusFilter}` : ""}`).then(r => setItems(r.data)).catch(() => {});
    api.get("/settings")
      .then((r) => setDeductionRates(resolveWithdrawalDeductionRates(r.data || {})))
      .catch(() => setDeductionRates(resolveWithdrawalDeductionRates()));
  };
  useEffect(() => { if (isAdmin) load(); /* eslint-disable-next-line */ }, [isAdmin, statusFilter]);
  if (!isAdmin) return <Navigate to="/app" replace />;

  const doApprove = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/withdrawals/${approveItem.id}/approve`, { utr, reason: "" });
      toast.success("Withdrawal approved");
      setApproveItem(null); setUtr("");
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Approve failed"); }
    finally { setBusy(false); }
  };
  const doReject = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/withdrawals/${rejectItem.id}/reject`, { reason: reason || "Not approved" });
      toast.success("Withdrawal rejected — amount refunded to member");
      setRejectItem(null); setReason("");
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Reject failed"); }
    finally { setBusy(false); }
  };

  const totalPending = items.filter(i => i.status === "pending").reduce((s, i) => s + (i.amount || 0), 0);
  const totalApproved = items.filter(i => i.status === "approved").reduce((s, i) => s + (i.amount || 0), 0);

  return (
    <div className="space-y-6" data-testid="withdrawals-page">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p>
        <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Withdrawal Queue</h1>
        <p className="text-sm text-muted-foreground font-body mt-1">Member wallet withdrawals — approve after off-platform payout, reject to auto-refund.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-amber-200 p-4"><p className="text-[10px] uppercase tracking-widest text-amber-800 font-semibold">Pending Payouts</p><p className="font-display font-black text-2xl text-emerald-950">{inr(totalPending)}</p></div>
        <div className="bg-white rounded-xl border border-emerald-200 p-4"><p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Approved (current filter)</p><p className="font-display font-black text-2xl text-emerald-950">{inr(totalApproved)}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Requests (filter)</p><p className="font-display font-black text-2xl text-emerald-950">{items.length}</p></div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-slate-600" />
        {["", "pending", "approved", "rejected"].map(s => (
          <button key={s || "all"} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition ${statusFilter === s ? "bg-emerald-900 text-white" : "bg-white border border-border text-slate-600 hover:bg-emerald-50"}`} data-testid={`wd-filter-${s || "all"}`}>
            {s || "All"}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-10 text-center">
          <Wallet className="w-10 h-10 text-slate-400 mx-auto" />
          <p className="mt-3 font-semibold text-emerald-950">No withdrawals — all clear!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(w => (
            <div key={w.id} className="bg-white rounded-xl border border-border p-5" data-testid={`wd-${w.id}`}>
              {(() => {
                const breakdown = getWithdrawalBreakdown(w, deductionRates);
                return (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_STYLES[w.status] || "bg-slate-100 text-slate-700"}`}>{w.status}</span>
                    <span className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">{w.user_member_code}</span>
                    <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">via {w.method}</span>
                  </div>
                  <p className="font-display font-black text-emerald-950 mt-1 text-lg">{w.user_name}</p>
                  <p className="text-xs text-muted-foreground font-body">{w.user_phone}{w.user_email ? ` · ${w.user_email}` : ""}</p>
                  {w.account_details && (
                    <div className="mt-2 bg-slate-50 border border-border rounded-lg p-2 text-xs font-mono text-slate-700 flex items-start justify-between gap-2">
                      <span className="whitespace-pre-wrap break-all">{w.account_details}</span>
                      <button onClick={() => { navigator.clipboard.writeText(w.account_details); toast.success("Copied"); }} className="text-emerald-800 hover:text-emerald-950 shrink-0" data-testid={`wd-copy-${w.id}`}><Copy className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                  {w.utr && <p className="text-[11px] text-emerald-700 mt-1 font-mono">UTR: {w.utr}</p>}
                  {w.rejection_reason && <p className="text-[11px] text-red-700 mt-1">Reason: {w.rejection_reason}</p>}
                  <p className="text-[11px] text-slate-600 mt-1">
                    Gross {inr(breakdown.grossAmount)} | TDS ({breakdown.tdsPercent}%) {inr(breakdown.tdsAmount)} | Admin ({breakdown.adminChargePercent}%) {inr(breakdown.adminChargeAmount)} | Net {inr(breakdown.netAmount)}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">{new Date(w.created_at).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <div className="inline-flex items-center gap-1.5 bg-emerald-950 text-amber-400 px-3 py-1.5 rounded-full font-display font-black">
                    <BadgeIndianRupee className="w-3.5 h-3.5" />
                    {inr(breakdown.netAmount)}
                  </div>
                </div>
              </div>
                );
              })()}
              {w.status === "pending" && (
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" onClick={() => setApproveItem(w)} className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-full" data-testid={`wd-approve-${w.id}`}><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve & mark paid</Button>
                  <Button size="sm" variant="outline" onClick={() => setRejectItem(w)} className="border-red-300 text-red-700 hover:bg-red-50 rounded-full" data-testid={`wd-reject-${w.id}`}><XCircle className="w-3.5 h-3.5 mr-1" /> Reject & refund</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Approve dialog */}
      <Dialog open={!!approveItem} onOpenChange={() => setApproveItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Withdrawal</DialogTitle>
            <DialogDescription>
              {approveItem?.user_name} · {inr(getWithdrawalBreakdown(approveItem || {}, deductionRates).netAmount)} · {approveItem?.method}
              <br />Confirm you have paid off-platform, then enter the UTR/reference below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-emerald-950">UTR / Bank Reference (optional)</label>
            <Input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. UTR123456789" data-testid="wd-utr-input" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveItem(null)}>Cancel</Button>
            <Button onClick={doApprove} disabled={busy} className="bg-emerald-700 hover:bg-emerald-800 text-white" data-testid="wd-confirm-approve">Confirm Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectItem} onOpenChange={() => setRejectItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Withdrawal</DialogTitle>
            <DialogDescription>
              {rejectItem?.user_name} · {inr(rejectItem?.amount || 0)}
              <br />Amount will be refunded back to the member's wallet automatically.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shown to member)" data-testid="wd-reject-reason" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectItem(null)}>Cancel</Button>
            <Button onClick={doReject} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white" data-testid="wd-confirm-reject">Confirm Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


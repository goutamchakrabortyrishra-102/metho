import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shield, Plus, CheckCircle2, XCircle, Clock, User as UserIcon } from "lucide-react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const StatusBadge = ({ status }) => {
  const m = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-red-100 text-red-700",
  }[status] || "bg-slate-100 text-slate-700";
  return <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${m}`}>{status}</span>;
};

export default function MPSClaimsPage() {
  const { user } = useAuth();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");
  const [claims, setClaims] = useState([]);
  const [fund, setFund] = useState(null);
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rejectClaim, setRejectClaim] = useState(null);
  const [rejectNote, setRejectNote] = useState("");
  const [form, setForm] = useState({
    user_id: "",
    amount: "",
    reason: "",
    claim_type: "standard",
    event_type: "",
    nominee_name: "",
    nominee_relation: "",
    nominee_phone: "",
    supporting_doc_url: "",
  });

  const load = async () => {
    try {
      const [c, f, m] = await Promise.all([
        api.get("/admin/mps-claims"),
        api.get("/admin/mps-fund"),
        api.get("/members"),
      ]);
      setClaims(c.data);
      setFund(f.data);
      setMembers(m.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Load failed");
    }
  };

  useEffect(() => { if (isAdmin) load(); /* eslint-disable-next-line */ }, [isAdmin]);
  if (!isAdmin) return <Navigate to="/app" replace />;

  const createClaim = async (e) => {
    e.preventDefault();
       if (!form.user_id || !form.amount || !form.reason) return toast.error("Fill in all fields");
    setBusy(true);
    try {
      await api.post("/admin/mps-claims", {
        user_id: form.user_id,
        amount: Number(form.amount),
        reason: form.reason,
        claim_type: form.claim_type,
        event_type: form.claim_type === "nominee_emergency" ? form.event_type : null,
        nominee_name: form.claim_type === "nominee_emergency" ? form.nominee_name : null,
        nominee_relation: form.claim_type === "nominee_emergency" ? form.nominee_relation : null,
        nominee_phone: form.claim_type === "nominee_emergency" ? form.nominee_phone : null,
        supporting_doc_url: form.supporting_doc_url || null,
      });
      toast.success("Claim created — awaiting approval");
      setCreating(false);
      setForm({
        user_id: "",
        amount: "",
        reason: "",
        claim_type: "standard",
        event_type: "",
        nominee_name: "",
        nominee_relation: "",
        nominee_phone: "",
        supporting_doc_url: "",
      });
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Create failed");
    } finally { setBusy(false); }
  };

  const approve = async (c) => {
    if (!window.confirm(`Approve MPS claim for ${c.user_name}?\nAmount: ${inr(c.amount)}\nThis will deduct from MPS Fund and credit their wallet.`)) return;
    setBusy(true);
    try {
      await api.post(`/admin/mps-claims/${c.id}/approve`, {});
      toast.success(`Approved · ${inr(c.amount)} credited to ${c.user_name}`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Approve failed");
    } finally { setBusy(false); }
  };

  const doReject = async () => {
    if (!rejectClaim) return;
    setBusy(true);
    try {
      await api.post(`/admin/mps-claims/${rejectClaim.id}/reject`, { note: rejectNote || "Rejected by admin" });
      toast.success("Claim rejected");
      setRejectClaim(null);
      setRejectNote("");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Reject failed");
    } finally { setBusy(false); }
  };

  const pending = claims.filter(c => c.status === "pending");
  const decided = claims.filter(c => c.status !== "pending");

  return (
    <div className="space-y-6" data-testid="mps-claims-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">MPS Claims</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">
            Members-এর emergency benefit claims। Approve করলে MPS Fund থেকে deduct হবে ও member wallet-এ credit হবে।
          </p>
            <p className="text-sm text-muted-foreground font-body mt-1">
              Emergency benefit claims from members. Approving a claim deducts from the MPS Fund and credits the member wallet.
            </p>
        </div>
        <Button onClick={() => setCreating(true)} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="new-mps-claim-button">
          <Plus className="w-4 h-4 mr-2" /> New Claim
        </Button>
      </div>

      {/* MPS Fund summary */}
      {fund && (
        <div className="rounded-xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950 text-white p-6 relative overflow-hidden" data-testid="mps-fund-hero">
          <div className="absolute inset-0 grain opacity-25" />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-400 text-emerald-950 flex items-center justify-center">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-bold">MPS Shield Fund Balance</p>
                <p className="font-display font-black text-4xl mt-1">{inr(fund.balance)}</p>
                <p className="text-xs text-emerald-100/70 mt-1">
                  Total contributions {inr(fund.total_contributions)} · Total paid out {inr(fund.total_approved_claims)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-emerald-100/80">
              <span className="uppercase tracking-widest text-amber-400/80 font-semibold col-span-2 mb-1">Rules from Settings</span>
              <span>Max claim:</span><span className="font-mono">{inr(fund.rules.mps_max_claim_amount)}</span>
              <span>Min active months:</span><span className="font-mono">{fund.rules.mps_min_active_months}</span>
              <span>Claim gap:</span><span className="font-mono">{fund.rules.mps_min_claim_gap_days} days</span>
              <span>Benefit duration:</span><span className="font-mono">{fund.rules.mps_benefit_duration_months} months</span>
            </div>
          </div>
        </div>
      )}

      {/* Pending queue */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-amber-700" />
          <h2 className="font-display font-bold text-emerald-950">Pending ({pending.length})</h2>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground font-body">No pending claims.</p>
        ) : (
          <div className="space-y-3">
            {pending.map(c => (
              <div key={c.id} className="bg-white rounded-xl border border-amber-200 p-5" data-testid={`claim-${c.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2"><StatusBadge status={c.status} /> <span className="text-xs text-muted-foreground">{new Date(c.requested_at).toLocaleString()}</span></div>
                    <p className="font-display font-bold text-emerald-950 mt-2">{c.user_name} <span className="text-xs text-muted-foreground font-body font-normal">· {c.member_code}</span></p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Claim type: <span className="font-semibold">{c.claim_type === "nominee_emergency" ? "Nominee Emergency" : "Standard"}</span>
                      {c.event_type ? ` · Event: ${c.event_type.replace("_", " ")}` : ""}
                    </p>
                    {c.nominee?.name && (
                      <p className="text-xs text-slate-600 mt-0.5">
                        Nominee: {c.nominee.name} ({c.nominee.relation || "N/A"}){c.nominee.phone ? ` · ${c.nominee.phone}` : ""}
                      </p>
                    )}
                    {c.supporting_doc_url && (
                      <a href={c.supporting_doc_url} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 underline mt-0.5 inline-block">
                        Supporting Document
                      </a>
                    )}
                    <p className="text-sm text-slate-700 mt-1 font-body">{c.reason}</p>
                  </div>
                  <p className="font-display font-black text-2xl text-emerald-950">{inr(c.amount)}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 justify-end">
                  <Button size="sm" onClick={() => approve(c)} disabled={busy} className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-full" data-testid={`approve-claim-${c.id}`}>
                    <CheckCircle2 className="w-4 h-4 mr-1" /> Approve · {inr(c.amount)}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejectClaim(c)} disabled={busy} className="border-red-300 text-red-700 hover:bg-red-50 rounded-full" data-testid={`reject-claim-${c.id}`}>
                    <XCircle className="w-4 h-4 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Decided log */}
      {decided.length > 0 && (
        <div>
          <h2 className="font-display font-bold text-emerald-950 mb-3">History ({decided.length})</h2>
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="divide-y divide-border">
              {decided.map(c => (
                <div key={c.id} className="p-4 flex flex-wrap justify-between gap-3 items-center">
                  <div>
                    <div className="flex items-center gap-2"><StatusBadge status={c.status} /> <span className="text-xs text-muted-foreground">{new Date(c.requested_at).toLocaleString()}</span></div>
                    <p className="text-sm font-semibold text-emerald-950 mt-1">{c.user_name} · {c.member_code}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Claim type: <span className="font-semibold">{c.claim_type === "nominee_emergency" ? "Nominee Emergency" : "Standard"}</span>
                      {c.event_type ? ` · Event: ${c.event_type.replace("_", " ")}` : ""}
                    </p>
                    {c.nominee?.name && (
                      <p className="text-xs text-slate-600 mt-0.5">
                        Nominee: {c.nominee.name} ({c.nominee.relation || "N/A"}){c.nominee.phone ? ` · ${c.nominee.phone}` : ""}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">{c.reason}</p>
                    {c.supporting_doc_url && (
                      <a href={c.supporting_doc_url} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 underline mt-0.5 inline-block">
                        Supporting Document
                      </a>
                    )}
                    {c.decision_note && <p className="text-xs text-red-700 mt-0.5">Note: {c.decision_note}</p>}
                  </div>
                  <p className="font-display font-bold text-emerald-950">{inr(c.amount)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* New claim dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New MPS Claim</DialogTitle>
            <DialogDescription>Create claim on behalf of a member. Amount must be within Admin-configured max.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createClaim} className="space-y-3" data-testid="new-mps-claim-form">
            <div>
              <Label htmlFor="member">Member</Label>
              <select
                id="member"
                required
                value={form.user_id}
                onChange={(e) => setForm({ ...form, user_id: e.target.value })}
                className="w-full mt-1.5 h-11 border border-border rounded-lg px-3 bg-white"
                data-testid="claim-member-select"
              >
                <option value="">Select member...</option>
                {members.filter(m => m.role !== "super_admin").map(m => (
                  <option key={m.id} value={m.id}>{m.name} · {m.member_code}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="claim_type">Claim Type</Label>
              <select
                id="claim_type"
                value={form.claim_type}
                onChange={(e) => setForm({
                  ...form,
                  claim_type: e.target.value,
                  event_type: "",
                  nominee_name: "",
                  nominee_relation: "",
                  nominee_phone: "",
                })}
                className="w-full mt-1.5 h-11 border border-border rounded-lg px-3 bg-white"
              >
                <option value="standard">Standard Claim</option>
                <option value="nominee_emergency">Nominee Emergency (Leader only)</option>
              </select>
            </div>
            {form.claim_type === "nominee_emergency" && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Nominee Emergency rule: user must be Leader-level, event must be Death or Critical Medical,
                and supporting document is mandatory.
              </div>
            )}
            {form.claim_type === "nominee_emergency" && (
              <>
                <div>
                  <Label htmlFor="event_type">Emergency Event</Label>
                  <select
                    id="event_type"
                    required
                    value={form.event_type}
                    onChange={(e) => setForm({ ...form, event_type: e.target.value })}
                    className="w-full mt-1.5 h-11 border border-border rounded-lg px-3 bg-white"
                  >
                    <option value="">Select event...</option>
                    <option value="death">Death</option>
                    <option value="critical_medical">Critical Medical</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="nominee_name">Nominee Name</Label>
                  <Input id="nominee_name" required value={form.nominee_name} onChange={(e) => setForm({ ...form, nominee_name: e.target.value })} className="mt-1.5 h-11" placeholder="e.g. Rahim Uddin" />
                </div>
                <div>
                  <Label htmlFor="nominee_relation">Nominee Relation</Label>
                  <Input id="nominee_relation" required value={form.nominee_relation} onChange={(e) => setForm({ ...form, nominee_relation: e.target.value })} className="mt-1.5 h-11" placeholder="e.g. Spouse / Son / Daughter" />
                </div>
                <div>
                  <Label htmlFor="nominee_phone">Nominee Phone (Optional)</Label>
                  <Input id="nominee_phone" value={form.nominee_phone} onChange={(e) => setForm({ ...form, nominee_phone: e.target.value })} className="mt-1.5 h-11" placeholder="e.g. +91..." />
                </div>
              </>
            )}
            <div>
              <Label htmlFor="supporting_doc_url">Supporting Document URL{form.claim_type === "nominee_emergency" ? " (Required)" : " (Optional)"}</Label>
              <Input
                id="supporting_doc_url"
                type="url"
                required={form.claim_type === "nominee_emergency"}
                value={form.supporting_doc_url}
                onChange={(e) => setForm({ ...form, supporting_doc_url: e.target.value })}
                className="mt-1.5 h-11"
                placeholder="https://..."
              />
            </div>
            <div>
              <Label htmlFor="amount">Claim Amount (₹)</Label>
              <Input id="amount" type="number" min="1" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={fund ? `Max ${inr(fund.rules.mps_max_claim_amount)}` : "e.g. 5000"} className="mt-1.5 h-11" data-testid="claim-amount-input" />
            </div>
            <div>
              <Label htmlFor="reason">Reason</Label>
              <Textarea id="reason" required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Medical emergency, family loss, business setback..." className="mt-1.5 min-h-[80px]" data-testid="claim-reason-input" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" disabled={busy} className="bg-emerald-900 hover:bg-emerald-950 text-white" data-testid="claim-submit-button">
                {busy ? "Creating..." : "Create Claim"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectClaim} onOpenChange={() => setRejectClaim(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Claim</DialogTitle>
            <DialogDescription>{rejectClaim?.user_name} · {inr(rejectClaim?.amount || 0)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Rejection reason (shown to member)</Label>
            <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="e.g. Not eligible per MPS rules..." data-testid="reject-note-input" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectClaim(null)}>Cancel</Button>
            <Button onClick={doReject} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white" data-testid="confirm-reject-claim">
              {busy ? "Rejecting..." : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


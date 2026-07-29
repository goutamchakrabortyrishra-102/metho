import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Package, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN")}`;

export default function ProductApprovalsPage() {
  const { user } = useAuth();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");
  const [items, setItems] = useState([]);
  const [rejectItem, setRejectItem] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/admin/products/pending").then(r => setItems(r.data)).catch(() => {});
  useEffect(() => { if (isAdmin) load(); /* eslint-disable-next-line */ }, [isAdmin]);
  if (!isAdmin) return <Navigate to="/app" replace />;

  const approve = async (p) => {
    setBusy(true);
    try { await api.post(`/admin/products/${p.id}/approve`); toast.success("Product approved & live"); load(); }
    catch (err) { toast.error(err?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };
  const doReject = async () => {
    setBusy(true);
    try { await api.post(`/admin/products/${rejectItem.id}/reject`, { reason: reason || "Not approved" }); toast.success("Rejected"); setRejectItem(null); setReason(""); load(); }
    catch (err) { toast.error(err?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6" data-testid="product-approvals-page">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p>
        <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Product Approvals</h1>
        <p className="text-sm text-muted-foreground font-body mt-1">Review and approve partner-uploaded products. Approved products will go live in the shop immediately.</p>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-10 text-center">
          <Package className="w-10 h-10 text-slate-400 mx-auto" />
          <p className="mt-3 font-semibold text-emerald-950">No pending products — সব review done!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-amber-200 p-4 flex gap-4" data-testid={`pending-product-${p.id}`}>
              <div className="w-24 h-24 rounded-lg bg-secondary shrink-0 overflow-hidden">
                <img src={p.image_url || undefined} alt={p.name} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><Clock className="w-3.5 h-3.5 text-amber-700" /><span className="text-[10px] uppercase font-bold text-amber-800">Pending Review</span></div>
                <p className="font-display font-bold text-emerald-950 mt-1">{p.name}</p>
                {p.product_code ? <p className="text-[10px] text-slate-500 font-mono">Code: {p.product_code}</p> : null}
                <p className="text-xs text-muted-foreground">{p.category} · Stock {p.stock}</p>
                <p className="font-display font-black text-emerald-800 mt-1">₹{p.price}</p>
                {p.description && <p className="text-xs text-slate-600 mt-1 line-clamp-2">{p.description}</p>}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => approve(p)} disabled={busy} className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-full" data-testid={`approve-prod-${p.id}`}>
                    <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejectItem(p)} disabled={busy} className="border-red-300 text-red-700 hover:bg-red-50 rounded-full" data-testid={`reject-prod-${p.id}`}>
                    <XCircle className="w-4 h-4 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!rejectItem} onOpenChange={() => setRejectItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Product</DialogTitle>
            <DialogDescription>{rejectItem?.name} · {inr(rejectItem?.price || 0)}</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shown to partner)" data-testid="reject-prod-reason" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectItem(null)}>Cancel</Button>
            <Button onClick={doReject} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white" data-testid="confirm-reject-prod">Confirm Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


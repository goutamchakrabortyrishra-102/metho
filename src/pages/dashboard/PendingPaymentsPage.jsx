import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Eye, Clock, ExternalLink, Package } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

const BACKEND = String(api?.defaults?.baseURL || "").replace(/\/?api\/?$/, "");

const StatusBadge = ({ status }) => {
  const map = {
    pending_payment: { c: "bg-slate-100 text-slate-700", t: "Payment Pending" },
    pending_approval: { c: "bg-amber-100 text-amber-800", t: "Awaiting Approval" },
    paid: { c: "bg-emerald-100 text-emerald-800", t: "Approved & Paid" },
    rejected: { c: "bg-red-100 text-red-700", t: "Rejected" },
  };
  const m = map[status] || { c: "bg-slate-100 text-slate-700", t: status };
  return <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${m.c}`}>{m.t}</span>;
};

export default function PendingPaymentsPage() {
  const { user } = useAuth();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewOrder, setViewOrder] = useState(null);
  const [rejectOrder, setRejectOrder] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/orders/pending");
      setOrders(data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/app" replace />;

  const approve = async (order) => {
    const isMethoQrProof = ["upi", "manual_upi"].includes(String(order?.payment_method || "").toLowerCase()) && !!order?.payment_screenshot_url;
    const confirmationText = isMethoQrProof
      ? `METHO QR payment ${order.order_no} confirm করবেন?\nএই approval-এর পর METHO product buyer-এর Member ID active হবে।`
      : `Order ${order.order_no} approve করবেন?\nCommission ও Smart Cycle credits এখন disburse হবে।`;
    if (!window.confirm(confirmationText)) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/orders/${order.id}/approve`, {});
      toast.success(data.member_purchase_activated ? "Payment confirmed and Member ID activated." : `Approved! Commission ₹${data.rewards_earned?.commission_pool?.toLocaleString("en-IN") || 0}`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Approve failed");
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    if (!rejectOrder) return;
    setBusy(true);
    try {
      await api.post(`/admin/orders/${rejectOrder.id}/reject`, { reason: rejectReason || "Payment could not be verified" });
      toast.success("Order rejected. User can resubmit.");
      setRejectOrder(null);
      setRejectReason("");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Reject failed");
    } finally {
      setBusy(false);
    }
  };

  const buildFileUrl = (u) => {
    if (!u) return "";
    if (u.startsWith("http")) return u;
    if (u.startsWith("/api/")) return `${BACKEND}${u}`;
    return u;
  };

  const pendingApproval = orders.filter(o => o.status === "pending_approval");
  const pendingPayment = orders.filter(o => o.status === "pending_payment");

  return (
    <div className="space-y-6" data-testid="pending-payments-page">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p>
        <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Pending Payments</h1>
        <p className="text-sm text-muted-foreground font-body mt-1">
          UPI-এ যেসব order-এর payment এসেছে সেগুলো verify ও approve করুন। Approve করলেই commission cycle trigger হবে।
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-border p-5">
          <p className="text-xs uppercase text-slate-500 font-semibold tracking-widest">Awaiting Approval</p>
          <p className="font-display font-black text-3xl text-amber-700 mt-2" data-testid="stat-awaiting">{pendingApproval.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-5">
          <p className="text-xs uppercase text-slate-500 font-semibold tracking-widest">Payment Not Yet</p>
          <p className="font-display font-black text-3xl text-slate-700 mt-2">{pendingPayment.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-5">
          <p className="text-xs uppercase text-slate-500 font-semibold tracking-widest">Total Pending Value</p>
          <p className="font-display font-black text-3xl text-emerald-900 mt-2">
            ₹{orders.reduce((s, o) => s + (o.total_amount || 0), 0).toLocaleString("en-IN")}
          </p>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {orders.length === 0 && !loading && (
        <div className="bg-white rounded-xl border border-border p-10 text-center">
          <Package className="w-10 h-10 text-slate-400 mx-auto" />
          <p className="mt-3 font-semibold text-emerald-950">সব order verified — কোনো payment pending নেই।</p>
          <p className="text-sm text-muted-foreground mt-1">নতুন UPI order এলে এখানে দেখা যাবে।</p>
        </div>
      )}

      <div className="space-y-3">
        {orders.map((o) => (
          <div key={o.id} className="bg-white rounded-xl border border-border p-5" data-testid={`pending-order-${o.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs uppercase tracking-[0.15em] text-emerald-800 font-semibold">{o.order_no}</p>
                  <StatusBadge status={o.status} />
                </div>
                <p className="font-display font-bold text-emerald-950 mt-1">{o.user_name || "Unknown"} <span className="text-xs text-muted-foreground font-body font-normal">· {o.user_email}</span></p>
                <p className="text-xs text-muted-foreground font-body mt-0.5">
                  <Clock className="w-3 h-3 inline mr-1" />{new Date(o.created_at).toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display font-black text-2xl text-emerald-950">₹{o.total_amount?.toLocaleString("en-IN")}</p>
                <p className="text-xs text-muted-foreground">{o.items?.length} item(s)</p>
              </div>
            </div>

            {o.status === "pending_approval" && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 p-3 bg-amber-50/60 border border-amber-200 rounded-lg">
                <div>
                  <p className="text-[10px] uppercase text-amber-900 font-bold tracking-wider">UPI Transaction ID</p>
                  <p className="font-mono text-sm text-emerald-950 mt-1 break-all">{o.txn_id || "—"}</p>
                  <p className="text-[11px] text-amber-800 mt-1">Method: {String(o.payment_method || "upi").toUpperCase()}{o.payment_screenshot_url ? " · METHO QR proof" : ""}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-amber-900 font-bold tracking-wider">Payer</p>
                  <p className="text-sm text-emerald-950 mt-1">{o.payer_name || o.user_name}</p>
                  <p className="text-xs text-muted-foreground">Submitted: {o.payment_submitted_at ? new Date(o.payment_submitted_at).toLocaleString() : "—"}</p>
                </div>
                <div className="flex items-start justify-end gap-2">
                  {o.payment_screenshot_url && (
                    <a href={buildFileUrl(o.payment_screenshot_url)} target="_blank" rel="noopener noreferrer" className="inline-block">
                      <img src={buildFileUrl(o.payment_screenshot_url)} alt="proof" className="w-16 h-16 object-cover rounded-lg border border-amber-300" />
                    </a>
                  )}
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setViewOrder(o)} data-testid={`view-order-${o.id}`}>
                <Eye className="w-4 h-4 mr-1" /> Details
              </Button>
              {o.status === "pending_approval" && (
                <>
                  <Button
                    size="sm"
                    onClick={() => approve(o)}
                    disabled={busy}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-full"
                    data-testid={`approve-order-${o.id}`}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1" /> {String(o.payment_method || "").toLowerCase() === "cod" ? "Verify Cash Payment" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRejectOrder(o)}
                    disabled={busy}
                    className="border-red-300 text-red-700 hover:bg-red-50 rounded-full"
                    data-testid={`reject-order-${o.id}`}
                  >
                    <XCircle className="w-4 h-4 mr-1" /> Reject
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Details modal */}
      <Dialog open={!!viewOrder} onOpenChange={() => setViewOrder(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Order Details — {viewOrder?.order_no}</DialogTitle>
            <DialogDescription>Review payment proof, customer info, and line items for this order.</DialogDescription>
          </DialogHeader>
          {viewOrder && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Customer</p><p className="font-semibold">{viewOrder.user_name}</p></div>
                <div><p className="text-xs text-muted-foreground">Email</p><p className="font-semibold">{viewOrder.user_email}</p></div>
                <div><p className="text-xs text-muted-foreground">Member Code</p><p className="font-semibold">{viewOrder.user_member_code}</p></div>
                <div><p className="text-xs text-muted-foreground">Total</p><p className="font-display font-black text-emerald-800">₹{viewOrder.total_amount?.toLocaleString("en-IN")}</p></div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Shipping Address</p>
                <p className="p-2 bg-secondary/50 rounded text-sm">{viewOrder.shipping_address}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Items</p>
                <div className="divide-y divide-border border rounded-lg">
                  {viewOrder.items?.map((it, i) => (
                    <div key={i} className="p-2 flex justify-between text-sm">
                      <span>{it.product_name} × {it.quantity} <span className="text-[10px] text-muted-foreground ml-1">({it.product_type})</span></span>
                      <span className="font-semibold">₹{it.subtotal?.toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </div>
              </div>
              {viewOrder.payment_screenshot_url && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Payment Screenshot</p>
                  <a href={buildFileUrl(viewOrder.payment_screenshot_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-800 hover:underline text-sm">
                    <img src={buildFileUrl(viewOrder.payment_screenshot_url)} alt="proof" className="max-h-64 rounded-lg border border-border" />
                    <ExternalLink className="w-4 h-4 ml-1" />
                  </a>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject modal */}
      <Dialog open={!!rejectOrder} onOpenChange={() => setRejectOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Payment — {rejectOrder?.order_no}</DialogTitle>
            <DialogDescription>Provide a rejection reason so the user can correct and resubmit payment.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">User কে কী reason দেখাবেন?</p>
            <div>
              <Label htmlFor="reject-reason">Rejection Reason</Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Screenshot অস্পষ্ট / টাকা এখনো credit হয়নি / txn_id মিলছে না ..."
                className="mt-1.5"
                data-testid="reject-reason-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOrder(null)} disabled={busy}>Cancel</Button>
            <Button onClick={doReject} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white" data-testid="confirm-reject-button">
              {busy ? "Rejecting..." : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


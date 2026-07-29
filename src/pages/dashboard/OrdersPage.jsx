import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import api from "@/services/api";
import { Package, RotateCcw, AlertCircle, FileText, FileArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import UpiPaymentDialog from "@/components/UpiPaymentDialog";
import { useAuth } from "@/contexts/AuthContext";

const BACKEND = String(api?.defaults?.baseURL || "").replace(/\/?api\/?$/, "");

const STATUS = {
  pending_payment: { c: "bg-slate-100 text-slate-700", t: "Payment Pending" },
  pending_approval: { c: "bg-amber-100 text-amber-800", t: "Awaiting Approval" },
  paid: { c: "bg-emerald-100 text-emerald-800", t: "Approved & Paid" },
  rejected: { c: "bg-red-100 text-red-700", t: "Rejected" },
  pending: { c: "bg-amber-100 text-amber-800", t: "Pending" },
  delivered: { c: "bg-emerald-100 text-emerald-800", t: "Delivered" },
  cancelled: { c: "bg-red-100 text-red-800", t: "Cancelled" },
};

export default function OrdersPage() {
  const { user } = useAuth();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");
  const [orders, setOrders] = useState([]);
  const [resubmit, setResubmit] = useState(null); // order object
  const now = new Date();
  const [bulkYear, setBulkYear] = useState(now.getFullYear());
  const [bulkMonth, setBulkMonth] = useState(now.getMonth() + 1);
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/orders").then(r => setOrders(r.data));
  useEffect(() => { load(); }, []);

  const downloadBulkZip = async () => {
    setBusy(true);
    try {
      const token = localStorage.getItem("metho_token");
      const url = `${BACKEND}/api/admin/invoices/bulk-zip?year=${bulkYear}&month=${bulkMonth}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `METHO_Invoices_${bulkYear}-${String(bulkMonth).padStart(2, "0")}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success("ZIP downloaded — contains HTML + e-invoice JSON per order");
    } catch (err) {
      toast.error("Bulk download failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="orders-page">
      <div className="flex flex-wrap justify-between gap-4 items-end">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Orders</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Order History</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">
            View the status of UPI orders here. If an order is rejected, the payment can be submitted again.
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-end gap-2 bg-emerald-50/50 border border-emerald-200 rounded-xl p-3" data-testid="bulk-zip-panel">
            <div>
              <p className="text-[10px] uppercase text-emerald-800 font-bold tracking-wider">Bulk Invoice ZIP</p>
              <div className="flex items-center gap-1 mt-1">
                <Input type="number" value={bulkYear} onChange={(e) => setBulkYear(Number(e.target.value))} className="h-9 w-24" data-testid="bulk-year-input" />
                <Input type="number" min={1} max={12} value={bulkMonth} onChange={(e) => setBulkMonth(Number(e.target.value))} className="h-9 w-16" data-testid="bulk-month-input" />
              </div>
            </div>
            <Button onClick={downloadBulkZip} disabled={busy} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full h-9" data-testid="bulk-download-button">
              <FileArchive className="w-4 h-4 mr-2" /> {busy ? "Zipping..." : "Download ZIP"}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {orders.length === 0 && (
          <div className="bg-white rounded-xl border border-border p-10 text-center">
            <Package className="w-10 h-10 text-slate-400 mx-auto" />
            <p className="mt-4 text-muted-foreground font-body">No orders yet. Head to Products to place your first order!</p>
          </div>
        )}
        {orders.map((o, i) => {
          const st = STATUS[o.status] || STATUS.pending;
          return (
            <div key={o.id} className="bg-white rounded-xl border border-border p-5" data-testid={`order-${i}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.15em] text-emerald-800 font-semibold">{o.order_no}</p>
                  <p className="text-xs text-muted-foreground font-body mt-1">{new Date(o.created_at).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${st.c}`}>{st.t}</span>
                  <p className="font-display font-black text-xl text-emerald-950">₹{o.total_amount?.toLocaleString("en-IN")}</p>
                </div>
              </div>

              {o.status === "rejected" && o.rejection_reason && (
                <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-red-800">Reject কারণ:</p>
                      <p className="text-xs font-semibold text-red-800">Rejection reason:</p>
                    <p className="text-sm text-red-900">{o.rejection_reason}</p>
                  </div>
                </div>
              )}

              <div className="mt-4 divide-y divide-border border-t border-border">
                {o.items?.map((it, j) => (
                  <div key={j} className="py-2 flex justify-between text-sm">
                    <span className="text-slate-700">{it.product_name} × {it.quantity}</span>
                    <span className="font-semibold">₹{it.subtotal?.toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap justify-between text-xs text-muted-foreground font-body gap-2">
                <span>METHO ₹{o.metho_amount?.toLocaleString("en-IN") || 0} · Partner ₹{o.associate_amount?.toLocaleString("en-IN") || 0}</span>
                <span>Ship to: {o.shipping_address}</span>
              </div>

              {o.txn_id && (
                <div className="mt-2 text-xs text-muted-foreground font-body">
                  <span>UPI Txn: <span className="font-mono text-emerald-900">{o.txn_id}</span></span>
                </div>
              )}

              {(o.status === "pending_payment" || o.status === "rejected") && (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => setResubmit(o)}
                    className="bg-amber-500 hover:bg-amber-600 text-emerald-950 rounded-full"
                    data-testid={`resubmit-payment-${i}`}
                  >
                    <RotateCcw className="w-4 h-4 mr-1" /> {o.status === "rejected" ? "Resubmit Payment" : "Submit Payment"}
                  </Button>
                </div>
              )}

              {(o.status === "paid" || o.status === "pending_approval" || o.status === "delivered") && (
                <div className="mt-3 flex justify-end">
                  <Link to={`/invoice/${o.id}`} target="_blank">
                    <Button size="sm" variant="outline" className="rounded-full border-emerald-800 text-emerald-900 hover:bg-emerald-50" data-testid={`invoice-btn-${i}`}>
                      <FileText className="w-4 h-4 mr-1" /> View Invoice
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <UpiPaymentDialog
        open={!!resubmit}
        onOpenChange={(v) => !v && setResubmit(null)}
        existingOrderId={resubmit?.id}
        items={resubmit?.items?.map((it) => ({ id: it.product_id, name: it.product_name, price: it.price, quantity: it.quantity, subtotal: it.subtotal })) || []}
        total={resubmit?.total_amount || 0}
        onOrderPlaced={() => { setResubmit(null); load(); }}
      />
    </div>
  );
}


import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import api from "@/services/api";
import { Package, RotateCcw, AlertCircle, FileText, FileArchive, Printer } from "lucide-react";
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
const liveLocationUrl = (location) => {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
};
const guideWhatsAppUrl = (guide, orderNo) => {
  const number = String(guide?.whatsapp || guide?.phone || "").replace(/\D/g, "");
  if (!number) return "";
  return `https://wa.me/${number}?text=${encodeURIComponent(`Hello ${guide?.name || "Guide"}, I am contacting you about ${orderNo}.`)}`;
};
const formatOrderItemQuantity = (item) => {
  const quantity = Number(item?.quantity || 0);
  const text = Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(3)));
  const unit = String(item?.unit_label || item?.unit_type || "piece").trim().toLowerCase();
  if (unit === "piece") return `${text} pc`;
  return `${text} ${unit}`;
};
const pdfText = (value) => String(value || "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "");

export default function OrdersPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");
  const [orders, setOrders] = useState([]);
  const [resubmit, setResubmit] = useState(null); // order object
  const now = new Date();
  const [bulkYear, setBulkYear] = useState(now.getFullYear());
  const [bulkMonth, setBulkMonth] = useState(now.getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const toLocalDateInput = (date) => {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  };
  const [sheetDate, setSheetDate] = useState(toLocalDateInput(now));
  const [sheetBusy, setSheetBusy] = useState(false);
  const vegetableScope = searchParams.get("scope") === "vegetable";
  const isVegetableOrder = (order) => Array.isArray(order?.items)
    && order.items.some((item) => String(item?.product_type || "").trim().toLowerCase() === "metho_vegetable");

  const load = () => api.get("/orders").then(r => setOrders(r.data));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!orders.some((order) => order.tourism_guide?.live_location)) return undefined;
    const intervalId = window.setInterval(load, 10000);
    return () => window.clearInterval(intervalId);
  }, [orders]);

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

  const printDailyOrderSheet = async () => {
    const dayOrders = orders.filter((o) => (!vegetableScope || isVegetableOrder(o)) && toLocalDateInput(new Date(o.created_at)) === sheetDate);
    if (dayOrders.length === 0) {
      toast.error("No orders found for the selected date");
      return;
    }
    setSheetBusy(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      let y = 14;

      doc.setFillColor(5, 46, 22);
      doc.rect(0, 0, W, 22, "F");
      doc.setTextColor(251, 191, 36);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("METHO Daily Order Sheet", 10, 10);
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(new Date(sheetDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }), W - 10, 10, { align: "right" });
      doc.text(`${dayOrders.length} order(s)`, W - 10, 17, { align: "right" });

      y = 30;
      dayOrders.forEach((order, idx) => {
        if (y > 255) {
          doc.addPage();
          y = 14;
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(10, y, W - 10, y);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(5, 46, 22);
        doc.text(pdfText(`${idx + 1}. ${order.order_no || `ORD-${String(order.id || "").slice(0, 8).toUpperCase()}`}`), 10, y + 6);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(71, 85, 105);
        doc.text(pdfText(`${new Date(order.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} - ${String(order.status || "").replace(/_/g, " ")}`), 10, y + 11);
        doc.text(pdfText(`Customer: ${String(order.customer_name || order.payer_name || order.buyer_name || "Guest Customer").slice(0, 48)}`), 10, y + 16);
        doc.text(pdfText(`Mobile: ${String(order.customer_phone || order.phone || order.buyer_phone || "Not provided").slice(0, 24)} - Member: ${String(order.member_code || order.member_ref || "-").slice(0, 20)}`), 10, y + 21);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(5, 46, 22);
        doc.text(`₹${Number(order.total_amount || 0).toLocaleString("en-IN")}`, W - 10, y + 6, { align: "right" });
        doc.setFont("helvetica", "normal");
        doc.setTextColor(71, 85, 105);
        doc.text(pdfText(`Payment: ${String(order.payment_method || "-").toUpperCase()}`), W - 10, y + 16, { align: "right" });
        doc.text(pdfText(`Deliver to: ${String(order.shipping_address || "-").slice(0, 58)}`), W - 10, y + 21, { align: "right" });

        let itemY = y + 26;
        doc.setFontSize(8);
        (order.items || []).forEach((item) => {
          if (itemY > 280) {
            doc.addPage();
            itemY = 14;
          }
          doc.setTextColor(51, 65, 85);
          doc.text(pdfText(`- ${item.product_name || "Item"} x${formatOrderItemQuantity(item)}`), 14, itemY);
          doc.text(`₹${Number(item.subtotal || 0).toLocaleString("en-IN")}`, W - 14, itemY, { align: "right" });
          itemY += 4.5;
        });
        doc.setFontSize(9);
        y = itemY + 4;
      });

      const totalPages = doc.internal.getNumberOfPages();
      for (let pg = 1; pg <= totalPages; pg++) {
        doc.setPage(pg);
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.text(`METHO Daily Order Sheet · ${sheetDate} · Page ${pg}/${totalPages}`, W / 2, 292, { align: "center" });
      }

      doc.save(`METHO_Order_Sheet_${sheetDate}.pdf`);
      toast.success("Daily order sheet PDF ready");
    } catch (err) {
      toast.error("Daily order sheet could not be generated");
    } finally {
      setSheetBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="orders-page">
      <div className="flex flex-wrap justify-between gap-4 items-end">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Orders</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">{vegetableScope ? "Vegetable Customer Orders" : "Order History"}</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">
            View the status of UPI orders here. If an order is rejected, the payment can be submitted again.
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex items-end gap-2 bg-emerald-50/50 border border-emerald-200 rounded-xl p-3" data-testid="daily-order-sheet-panel">
              <div>
                <p className="text-[10px] uppercase text-emerald-800 font-bold tracking-wider">Daily Order Sheet</p>
                <Input type="date" value={sheetDate} onChange={(e) => setSheetDate(e.target.value)} className="h-9 mt-1" data-testid="daily-order-sheet-date-input" />
              </div>
              <Button onClick={printDailyOrderSheet} disabled={sheetBusy} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full h-9" data-testid="daily-order-sheet-button">
                <Printer className="w-4 h-4 mr-2" /> {sheetBusy ? "Preparing..." : "Print Day's Orders"}
              </Button>
            </div>
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
          </div>
        )}
      </div>

      <div className="space-y-4">
        {orders.filter((order) => !vegetableScope || isVegetableOrder(order)).length === 0 && (
          <div className="bg-white rounded-xl border border-border p-10 text-center">
            <Package className="w-10 h-10 text-slate-400 mx-auto" />
            <p className="mt-4 text-muted-foreground font-body">No orders yet. Head to Products to place your first order!</p>
          </div>
        )}
        {orders.filter((order) => !vegetableScope || isVegetableOrder(order)).map((o, i) => {
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
                    <span className="text-slate-700">{it.product_name} × {formatOrderItemQuantity(it)}</span>
                    <span className="font-semibold">₹{it.subtotal?.toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap justify-between text-xs text-muted-foreground font-body gap-2">
                <span>METHO ₹{o.metho_amount?.toLocaleString("en-IN") || 0} · Partner ₹{o.associate_amount?.toLocaleString("en-IN") || 0}</span>
                <span>Ship to: {o.shipping_address}</span>
              </div>

              {o.tourism_guide ? (
                <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
                  <p className="text-xs font-semibold text-sky-900">Tour guide: {o.tourism_guide.name || "Assigned guide"}</p>
                  <p className="text-[11px] text-slate-600 mt-1">{o.tourism_guide.phone || "Mobile not available"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {o.tourism_guide.live_location ? <a href={liveLocationUrl(o.tourism_guide.live_location)} target="_blank" rel="noreferrer" className="rounded-full border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-900">Open live location</a> : <span className="text-[11px] text-slate-500">Guide GPS is not sharing yet.</span>}
                    {o.tourism_guide.phone ? <a href={`tel:${o.tourism_guide.phone}`} className="rounded-full border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-900">Call guide</a> : null}
                    {guideWhatsAppUrl(o.tourism_guide, o.order_no) ? <a href={guideWhatsAppUrl(o.tourism_guide, o.order_no)} target="_blank" rel="noreferrer" className="rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">WhatsApp guide</a> : null}
                  </div>
                </div>
              ) : null}

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

              {(o.status === "paid" || o.status === "delivered") && (
                <div className="mt-3 flex justify-end">
                  <Link to={`/invoice/${o.id}`} target="_blank">
                    <Button size="sm" variant="outline" className="rounded-full border-emerald-800 text-emerald-900 hover:bg-emerald-50" data-testid={`invoice-btn-${i}`}>
                      <FileText className="w-4 h-4 mr-1" /> View Invoice
                    </Button>
                  </Link>
                </div>
              )}

              {o.status === "pending_approval" && (
                <div className="mt-3 flex justify-end">
                  <p className="text-[11px] text-amber-700">Online invoice admin approval/payment complete হলে open হবে।</p>
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


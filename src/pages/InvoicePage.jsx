import React, { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { Printer, ArrowLeft, FileText, FileJson, ShieldCheck, Loader2, QrCode, MessageCircle } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const inr = (v) => (Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const words = (n) => { // Basic number → Indian words for grand total (rounded rupees)
  if (n == null) return "";
  const one = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const ten = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  const two = (num) => num < 20 ? one[num] : ten[Math.floor(num/10)] + (num % 10 ? " " + one[num%10] : "");
  const chunk = (num) => {
    if (num === 0) return "";
    if (num < 100) return two(num);
    return one[Math.floor(num/100)] + " Hundred" + (num % 100 ? " " + two(num % 100) : "");
  };
  const int = Math.floor(n);
  const crore = Math.floor(int / 10000000);
  const lakh = Math.floor((int % 10000000) / 100000);
  const thousand = Math.floor((int % 100000) / 1000);
  const remainder = int % 1000;
  let out = [];
  if (crore) out.push(chunk(crore) + " Crore");
  if (lakh) out.push(chunk(lakh) + " Lakh");
  if (thousand) out.push(chunk(thousand) + " Thousand");
  if (remainder) out.push(chunk(remainder));
  return (out.join(" ") || "Zero") + " Rupees Only";
};

export default function InvoicePage() {
  const BACKEND = String(api?.defaults?.baseURL || "").replace(/\/?api\/?$/, "");
  const { orderId } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");
  const [inv, setInv] = useState(null);
  const [err, setErr] = useState(null);
  const [submittingIrn, setSubmittingIrn] = useState(false);

  useEffect(() => {
    api.get(`/orders/${orderId}/invoice`).then(r => setInv(r.data)).catch(e => setErr(e?.response?.data?.detail || "Failed to load invoice"));
  }, [orderId]);

  useEffect(() => {
    if (!inv) return;
    if (searchParams.get("autoprint") !== "1") return;
    const timer = setTimeout(() => {
      window.print();
    }, 350);
    return () => clearTimeout(timer);
  }, [inv, searchParams]);

  const submitEinvoice = async () => {
    setSubmittingIrn(true);
    try {
      const { data } = await api.post(`/admin/orders/${orderId}/einvoice/submit`);
      const ei = data.einvoice || {};
      setInv({ ...inv, einvoice: ei });
      toast.success(data.already_submitted ? "Already submitted" : `IRN generated: ${ei.irn?.slice(0, 12)}…`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "E-Invoice submission failed");
    } finally { setSubmittingIrn(false); }
  };

  const shareInvoicePdfOnWhatsApp = async () => {
    try {
      const token = localStorage.getItem("metho_token");
      const res = await fetch(`${BACKEND}/api/orders/${orderId}/invoice/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("PDF fetch failed");

      const blob = await res.blob();
      const fileName = `${inv.invoice_no || "invoice"}.pdf`;
      const file = new File([blob], fileName, { type: "application/pdf" });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Invoice ${inv.invoice_no}`,
          text: `Invoice ${inv.invoice_no} from METHOO STORE`,
          files: [file],
        });
        toast.success("Invoice shared");
        return;
      }

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();

      const msg = `Invoice ${inv.invoice_no} downloaded. Please attach the PDF in WhatsApp and send.`;
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
      toast.success("PDF downloaded. Attach it in WhatsApp.");
    } catch {
      toast.error("WhatsApp share failed");
    }
  };

  if (err) return <div className="p-8 text-center text-red-700">{err}</div>;
  if (!inv) return <div className="p-8 text-center text-muted-foreground">Loading invoice...</div>;

  const invoiceItems = Array.isArray(inv.items) ? inv.items : [];
  const isServiceRow = (it) => {
    if (it?.is_service === true) return true;
    const listingType = String(it?.listing_type || "").trim().toLowerCase();
    const itemKind = String(it?.item_kind || "").trim().toLowerCase();
    return listingType === "service" || itemKind === "service";
  };
  const summaryServiceInvoice =
    invoiceItems.length > 0 &&
    invoiceItems.every((it) => isServiceRow(it)) &&
    invoiceItems.some((it) => String(it?.service_invoice_mode || "").trim().toLowerCase() === "summary_total");

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0" data-testid="invoice-page">
      {/* Top action bar — hidden in print */}
      <div className="max-w-4xl mx-auto px-4 flex items-center justify-between mb-4 print:hidden">
        <Link to="/app/orders" className="inline-flex items-center gap-2 text-emerald-900 hover:underline font-semibold text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Orders
        </Link>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const { data } = await api.get(`/orders/${orderId}/invoice.json`);
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${inv.invoice_no}_einvoice.json`;
                document.body.appendChild(a); a.click(); a.remove();
                toast.success("E-invoice JSON downloaded");
              } catch { toast.error("Download failed"); }
            }}
            className="rounded-full border-emerald-800 text-emerald-900 hover:bg-emerald-50"
            data-testid="download-einvoice-json"
          >
            <FileJson className="w-4 h-4 mr-2" /> E-invoice JSON
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const token = localStorage.getItem("metho_token");
                const res = await fetch(`${BACKEND}/api/orders/${orderId}/invoice/pdf`, { headers: { Authorization: `Bearer ${token}` } });
                if (!res.ok) throw new Error();
                const blob = await res.blob();
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${inv.invoice_no}.pdf`;
                document.body.appendChild(a); a.click(); a.remove();
                toast.success("PDF downloaded");
              } catch { toast.error("PDF download failed"); }
            }}
            className="rounded-full border-emerald-800 text-emerald-900 hover:bg-emerald-50"
            data-testid="download-invoice-pdf"
          >
            <FileText className="w-4 h-4 mr-2" /> Download PDF
          </Button>
          <Button
            variant="outline"
            onClick={shareInvoicePdfOnWhatsApp}
            className="rounded-full border-green-700 text-green-800 hover:bg-green-50"
            data-testid="share-invoice-whatsapp"
          >
            <MessageCircle className="w-4 h-4 mr-2" /> Share on WhatsApp
          </Button>
          <Button onClick={() => window.print()} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="print-invoice-button">
            <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
          </Button>
        </div>
      </div>

      {/* E-Invoice / IRN Banner */}
      {inv.einvoice?.irn ? (
        <div className="max-w-4xl mx-auto px-4 mb-4 print:hidden">
          <div className="rounded-xl border-2 border-emerald-500 bg-gradient-to-r from-emerald-50 to-white p-4 flex flex-wrap items-center gap-4" data-testid="einvoice-banner">
            <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">
                GSTN E-Invoice · {inv.einvoice.provider === "mock" ? "Mock/Sandbox" : "Live"}
              </p>
              <p className="font-mono text-xs text-emerald-950 truncate" data-testid="einvoice-irn">
                IRN: <span className="font-bold">{inv.einvoice.irn}</span>
              </p>
              <p className="text-xs text-slate-600">
                Ack No: <span className="font-mono font-semibold">{inv.einvoice.ack_no}</span>
                {inv.einvoice.ack_dt && <> · Ack Dt: <span className="font-mono">{new Date(inv.einvoice.ack_dt).toLocaleString()}</span></>}
              </p>
            </div>
            {inv.einvoice.signed_qr_png && (
              <img src={inv.einvoice.signed_qr_png} alt="Signed QR" className="w-24 h-24 rounded-md border border-emerald-300 bg-white p-1" data-testid="einvoice-qr" />
            )}
          </div>
        </div>
      ) : isAdmin ? (
        <div className="max-w-4xl mx-auto px-4 mb-4 print:hidden">
          <div className="rounded-xl border-2 border-dashed border-amber-400 bg-amber-50/50 p-4 flex flex-wrap items-center gap-3">
            <QrCode className="w-8 h-8 text-amber-700 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-emerald-950 text-sm">E-Invoice not yet submitted</p>
              <p className="text-xs text-slate-600">Generate the IRN and signed QR. First configure the provider in Settings → E-Invoice.</p>
            </div>
            <Button onClick={submitEinvoice} disabled={submittingIrn} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="submit-einvoice-btn">
              {submittingIrn ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</> : <><ShieldCheck className="w-4 h-4 mr-2" /> Submit to GSTN</>}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Printable page */}
      <div className="max-w-4xl mx-auto bg-white shadow-lg print:shadow-none border border-slate-200 print:border-0" id="invoice-print">
        {/* Header */}
        <div className="border-b-4 border-emerald-900 px-8 py-6 flex items-start justify-between bg-gradient-to-br from-emerald-50/40 to-white">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-amber-600 font-bold">Tax Invoice</p>
            <h1 className="font-display font-black text-3xl text-emerald-950 mt-1">{inv.seller.name}</h1>
            <p className="text-xs text-slate-600 font-body mt-1">{inv.seller.address}</p>
            <p className="text-xs text-slate-600 font-body">GSTIN: <span className="font-mono font-semibold">{inv.seller.gst_no}</span> · PAN: <span className="font-mono">{inv.seller.pan}</span></p>
            <p className="text-xs text-slate-600 font-body">State: {inv.seller.state} ({inv.seller.state_code}) · Email: {inv.seller.email}</p>
          </div>
          <div className="text-right">
            <div className="inline-flex items-center gap-1 text-emerald-900 font-bold text-lg font-display"><FileText className="w-5 h-5" /> INVOICE</div>
            <p className="mt-2 text-xs text-slate-500 uppercase tracking-wider font-semibold">Invoice No</p>
            <p className="font-mono font-bold text-emerald-950">{inv.invoice_no}</p>
            <p className="mt-2 text-xs text-slate-500 uppercase tracking-wider font-semibold">Date</p>
            <p className="text-sm font-semibold text-emerald-950">{new Date(inv.invoice_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
            <p className="mt-2 text-xs text-slate-500 uppercase tracking-wider font-semibold">Order Ref</p>
            <p className="font-mono text-xs text-emerald-800">{inv.order_no}</p>
            {inv.einvoice?.irn && (
              <div className="mt-3 border-t border-slate-200 pt-2 flex items-start gap-2 justify-end">
                {inv.einvoice.signed_qr_png && <img src={inv.einvoice.signed_qr_png} alt="IRN QR" className="w-16 h-16 bg-white border border-slate-200 p-0.5 rounded" />}
                <div className="text-left">
                  <p className="text-[9px] uppercase tracking-widest text-emerald-800 font-bold">GSTN E-Invoice</p>
                  <p className="text-[9px] font-mono text-slate-700 break-all max-w-[140px]">IRN: {inv.einvoice.irn.slice(0, 30)}…</p>
                  <p className="text-[9px] font-mono text-slate-700">Ack: {inv.einvoice.ack_no}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Buyer info */}
        <div className="grid grid-cols-2 gap-6 px-8 py-5 border-b border-slate-200">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Bill To / Ship To</p>
            <p className="font-display font-bold text-emerald-950 mt-1">{inv.buyer.name}</p>
            <p className="text-xs text-slate-600 font-body mt-0.5">{inv.buyer.email}{inv.buyer.phone ? ` · ${inv.buyer.phone}` : ""}</p>
            <p className="text-xs text-slate-600 font-body mt-1">Member Code: <span className="font-mono font-semibold">{inv.buyer.member_code}</span></p>
            <p className="text-xs text-slate-700 font-body mt-2 whitespace-pre-line">{inv.buyer.shipping_address}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Payment</p>
            <p className="text-sm text-emerald-950 font-body mt-1">Method: <span className="font-semibold uppercase">{inv.payment.method || "—"}</span></p>
            {inv.payment.txn_id && <p className="text-xs text-slate-700 font-body">Txn ID: <span className="font-mono">{inv.payment.txn_id}</span></p>}
            <p className="text-xs text-slate-600 font-body mt-2">
              Status: <span className={`font-bold uppercase text-[10px] px-2 py-0.5 rounded-full ${inv.status === "paid" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{inv.status}</span>
            </p>
          </div>
        </div>

        {/* Items */}
        <div className="px-8 py-5">
          {summaryServiceInvoice ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4" data-testid="invoice-summary-service-mode">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">Service Invoice · Summary Mode</p>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Service Lines</p>
                  <p className="font-display font-extrabold text-emerald-950 text-xl">{invoiceItems.length}</p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Grand Total</p>
                  <p className="font-display font-extrabold text-emerald-900 text-xl">₹{inr(inv.grand_total)}</p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Mode</p>
                  <p className="font-semibold text-emerald-950">Unorganized Service</p>
                </div>
              </div>
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-emerald-900 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wider">#</th>
                  <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wider">Item</th>
                  <th className="text-center px-3 py-2 font-semibold text-xs uppercase tracking-wider">HSN/SAC</th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wider">Qty</th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wider">Rate (₹)</th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wider">Pre-Tax (₹)</th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wider">CGST</th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wider">SGST</th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wider">Total (₹)</th>
                </tr>
              </thead>
              <tbody>
                {invoiceItems.map((it, i) => (
                  <tr key={i} className={i % 2 ? "bg-slate-50" : ""}>
                    <td className="px-3 py-2 text-xs">{i + 1}</td>
                    <td className="px-3 py-2"><p className="font-semibold text-emerald-950">{it.product_name}</p><p className="text-[10px] text-slate-500">{it.product_type}</p></td>
                    <td className="text-center px-3 py-2 font-mono text-xs">{it.hsn_sac}</td>
                    <td className="text-right px-3 py-2">{it.quantity}</td>
                    <td className="text-right px-3 py-2">{inr(it.price)}</td>
                    <td className="text-right px-3 py-2">{inr(it.pre_tax)}</td>
                    <td className="text-right px-3 py-2 text-xs">{inr(it.cgst)}<br /><span className="text-[9px] text-slate-500">@{(it.gst_rate/2).toFixed(1)}%</span></td>
                    <td className="text-right px-3 py-2 text-xs">{inr(it.sgst)}<br /><span className="text-[9px] text-slate-500">@{(it.gst_rate/2).toFixed(1)}%</span></td>
                    <td className="text-right px-3 py-2 font-semibold">{inr(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-emerald-900 font-bold">
                  <td colSpan="5" className="px-3 py-2 text-right text-emerald-950">Sub-total</td>
                  <td className="text-right px-3 py-2">{inr(inv.subtotal_pre_tax)}</td>
                  <td className="text-right px-3 py-2">{inr(inv.total_cgst)}</td>
                  <td className="text-right px-3 py-2">{inr(inv.total_sgst)}</td>
                  <td className="text-right px-3 py-2 text-emerald-950">₹{inr(inv.grand_total)}</td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* Total in words */}
          <div className="mt-4 p-3 bg-amber-50 border-l-4 border-amber-500 rounded">
            <p className="text-[10px] uppercase tracking-widest text-amber-800 font-bold">Amount in Words</p>
            <p className="font-display font-bold text-emerald-950 mt-1">{words(inv.grand_total)}</p>
          </div>

          {/* Totals summary block */}
          <div className="mt-4 flex justify-end">
            <div className="w-full max-w-xs space-y-1 text-sm">
              {!summaryServiceInvoice ? <div className="flex justify-between"><span className="text-slate-600">Taxable Value:</span><span className="font-mono font-semibold">₹{inr(inv.subtotal_pre_tax)}</span></div> : null}
              {!summaryServiceInvoice ? <div className="flex justify-between"><span className="text-slate-600">CGST:</span><span className="font-mono">₹{inr(inv.total_cgst)}</span></div> : null}
              {!summaryServiceInvoice ? <div className="flex justify-between"><span className="text-slate-600">SGST:</span><span className="font-mono">₹{inr(inv.total_sgst)}</span></div> : null}
              <div className="flex justify-between pt-2 border-t-2 border-emerald-900 font-display font-black text-lg">
                <span className="text-emerald-950">Grand Total</span>
                <span className="text-emerald-800">₹{inr(inv.grand_total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-slate-200 bg-slate-50/70 text-xs text-slate-600">
          <p className="whitespace-pre-line italic">{inv.notes}</p>
          <div className="grid grid-cols-2 gap-6 mt-4">
            <div>
              <p className="font-semibold text-emerald-950">Payment Details</p>
              <p>UPI: <span className="font-mono">{inv.seller.upi_id}</span></p>
              <p>Payee: {inv.seller.name}</p>
            </div>
            <div className="text-right">
              <p className="italic mb-8">For {inv.seller.name}</p>
              <div className="border-t border-slate-400 inline-block pt-1 min-w-[160px]"><p className="font-semibold text-emerald-950">Authorised Signatory</p></div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          #invoice-print { box-shadow: none !important; border: none !important; }
        }
      `}</style>
    </div>
  );
}


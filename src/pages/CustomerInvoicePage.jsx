import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Download, Loader2, UserPlus, Printer, MessageCircle } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { openWhatsAppShare } from "@/lib/utils";

const inr = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const words = (n) => {
  if (n == null) return "";
  const one = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const ten = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (num) => num < 20 ? one[num] : ten[Math.floor(num / 10)] + (num % 10 ? " " + one[num % 10] : "");
  const chunk = (num) => {
    if (num === 0) return "";
    if (num < 100) return two(num);
    return one[Math.floor(num / 100)] + " Hundred" + (num % 100 ? " " + two(num % 100) : "");
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

const normalizePhone = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
};

export default function CustomerInvoicePage() {
  const { orderId } = useParams();
  const [searchParams] = useSearchParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const token = String(searchParams.get("token") || "").trim();

  useEffect(() => {
    if (!orderId || !token) {
      setError("Missing access token. Please open this invoice from customer order page.");
      return;
    }

    let active = true;
    setLoading(true);
    setError("");
    api
      .get(`/customer/mobile-access/orders/${orderId}/invoice`, { params: { token } })
      .then((r) => {
        if (!active) return;
        setInvoice(r.data || null);
      })
      .catch((err) => {
        if (!active) return;
        setInvoice(null);
        setError(err?.response?.data?.detail || "Could not load invoice");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [orderId, token]);

  useEffect(() => {
    if (!invoice) return;
    if (searchParams.get("print") !== "1") return;
    const timer = setTimeout(() => {
      window.print();
    }, 350);
    return () => clearTimeout(timer);
  }, [invoice, searchParams]);

  const registerLink = useMemo(() => {
    const name = String(invoice?.buyer?.name || "").trim();
    const phone = normalizePhone(invoice?.buyer?.phone || "");
    const qs = new URLSearchParams();
    if (name) qs.set("prefill_name", name);
    if (phone) qs.set("prefill_phone", phone);
    const text = qs.toString();
    return `/register${text ? `?${text}` : ""}`;
  }, [invoice?.buyer?.name, invoice?.buyer?.phone]);

  const downloadPdf = async () => {
    if (!invoice) return;
    setDownloading(true);
    try {
      window.print();
      toast.success("Print dialog opened. Choose Save as PDF to download the invoice.");
    } catch (err) {
      toast.error("Print dialog failed");
    } finally {
      setDownloading(false);
    }
  };

  const shareInvoiceOnWhatsApp = async () => {
    if (!orderId || !token || !invoice) return;
    try {
      const { data } = await api.get(`/customer/mobile-access/orders/${orderId}/invoice/pdf`, {
        params: { token },
        responseType: "blob",
      });
      const fileName = `${invoice.invoice_no || `INV-${orderId}`}.pdf`;
      const pdfBlob = data instanceof Blob ? data : new Blob([data], { type: "application/pdf" });
      const file = new File([pdfBlob], fileName, { type: "application/pdf" });
      const invoiceUrl = `${window.location.origin}/customer-invoice/${orderId}?token=${encodeURIComponent(token)}`;

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Invoice ${invoice.invoice_no}`,
          text: `Invoice ${invoice.invoice_no} from METHO. ${invoiceUrl}`,
          files: [file],
        });
        toast.success("Invoice PDF shared");
        return;
      }

      const objectUrl = URL.createObjectURL(pdfBlob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      openWhatsAppShare({ text: `Invoice ${invoice.invoice_no}: ${invoiceUrl}\nPDF downloaded. Please attach it in WhatsApp.` });
      toast.success("PDF downloaded and WhatsApp opened");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "WhatsApp share failed");
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <div className="max-w-4xl mx-auto px-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link to="/customer-orders" className="inline-flex items-center gap-2 text-emerald-900 hover:underline font-semibold text-sm">
            <ArrowLeft className="w-4 h-4" /> Back to Customer Orders
          </Link>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button
              type="button"
              variant="outline"
              onClick={downloadPdf}
              disabled={!invoice || downloading}
              className="rounded-full border-emerald-800 text-emerald-900 hover:bg-emerald-50"
              data-testid="customer-invoice-download-pdf"
            >
              {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />} Download PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={shareInvoiceOnWhatsApp}
              disabled={!invoice}
              className="rounded-full border-green-700 text-green-800 hover:bg-green-50"
              data-testid="customer-invoice-share-whatsapp"
            >
              <MessageCircle className="w-4 h-4 mr-2" /> Share on WhatsApp
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.print();
                toast.success("Print dialog opened. Choose Save as PDF to download the invoice.");
              }}
              disabled={!invoice}
              className="rounded-full border-emerald-800 text-emerald-900 hover:bg-emerald-50"
              data-testid="customer-invoice-print"
            >
              <Printer className="w-4 h-4 mr-2" /> Print / Save PDF
            </Button>
            <Link to={registerLink}>
              <Button type="button" className="rounded-full bg-amber-400 hover:bg-amber-500 text-emerald-950" data-testid="customer-invoice-add-member">
                <UserPlus className="w-4 h-4 mr-2" /> Add to Member
              </Button>
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl border border-border p-10 text-center text-slate-600">
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            <p className="mt-2 text-sm">Loading invoice...</p>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="bg-white rounded-xl border border-red-200 p-6 text-red-700" data-testid="customer-invoice-error">
            {error}
          </div>
        ) : null}

        {!loading && !error && invoice ? (() => {
          const invoiceItems = Array.isArray(invoice.items) ? invoice.items : [];
          return (
            <div className="max-w-4xl mx-auto bg-white shadow-lg print:shadow-none border border-slate-200 print:border-0 invoice-a4" id="customer-invoice-print" data-testid="customer-invoice-view">
              <div className="border-b-2 border-black px-6 py-4 flex items-start justify-between bg-white">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.25em] text-amber-600 font-bold">Tax Invoice</p>
                  <h1 className="font-display font-black text-3xl text-emerald-950 mt-1">{invoice.seller?.name || "METHO Vegetable"}</h1>
                  <p className="text-xs text-slate-600 font-body mt-1">{invoice.seller?.address || ""}</p>
                  <p className="text-xs text-slate-600 font-body">GSTIN: <span className="font-mono font-semibold">{invoice.seller?.gst_no || "-"}</span> · PAN: <span className="font-mono">{invoice.seller?.pan || "-"}</span></p>
                  <p className="text-xs text-slate-600 font-body">State: {invoice.seller?.state || "West Bengal"} ({invoice.seller?.state_code || "19"}) · Email: {invoice.seller?.email || "-"}{invoice.seller?.phone ? ` · Phone: ${invoice.seller.phone}` : ""}</p>
                </div>
                <div className="text-right">
                  <div className="inline-flex items-center gap-1 text-emerald-900 font-bold text-lg font-display"><Printer className="w-5 h-5" /> INVOICE</div>
                  <p className="mt-2 text-xs text-slate-500 uppercase tracking-wider font-semibold">Invoice No</p>
                  <p className="font-mono font-bold text-emerald-950">{invoice.invoice_no}</p>
                  <p className="mt-2 text-xs text-slate-500 uppercase tracking-wider font-semibold">Date</p>
                  <p className="text-sm font-semibold text-emerald-950">{new Date(invoice.invoice_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
                  <p className="mt-2 text-xs text-slate-500 uppercase tracking-wider font-semibold">Order Ref</p>
                  <p className="font-mono text-xs text-emerald-800">{invoice.order_no}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 px-6 py-3 border-b border-black">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Customer / Delivery</p>
                  <p className="font-display font-bold text-emerald-950 mt-1">{invoice.buyer?.name || "Customer"}</p>
                  {invoice.buyer?.email ? <p className="text-xs text-slate-600 font-body mt-0.5">Email: {invoice.buyer.email}</p> : null}
                  <p className="text-xs text-slate-600 font-body mt-0.5">Delivery Contact: <span className="font-semibold">{invoice.buyer?.phone || "Not provided"}</span></p>
                  <p className="text-xs text-slate-600 font-body mt-1">Member Code: <span className="font-mono font-semibold">{invoice.buyer?.member_code || "-"}</span></p>
                  <p className="text-xs text-slate-700 font-body mt-2 whitespace-pre-line"><span className="font-semibold">Delivery Address:</span> {invoice.buyer?.shipping_address || "Not provided"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Payment</p>
                  <p className="text-sm text-emerald-950 font-body mt-1">Method: <span className="font-semibold uppercase">{invoice.payment?.method || "—"}</span></p>
                  {invoice.payment?.txn_id && <p className="text-xs text-slate-700 font-body">Txn ID: <span className="font-mono">{invoice.payment.txn_id}</span></p>}
                  <p className="text-xs text-slate-600 font-body mt-2">Status: <span className={`font-bold uppercase text-[10px] px-2 py-0.5 rounded-full ${invoice.status === "paid" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{invoice.status}</span></p>
                </div>
              </div>

              <div className="px-8 py-5">
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
                        <td className="text-right px-3 py-2 text-xs">{inr(it.cgst)}<br /><span className="text-[9px] text-slate-500">@{((it.gst_rate || 0) / 2).toFixed(1)}%</span></td>
                        <td className="text-right px-3 py-2 text-xs">{inr(it.sgst)}<br /><span className="text-[9px] text-slate-500">@{((it.gst_rate || 0) / 2).toFixed(1)}%</span></td>
                        <td className="text-right px-3 py-2 font-semibold">{inr(it.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-emerald-900 font-bold">
                      <td colSpan="5" className="px-3 py-2 text-right text-emerald-950">Sub-total</td>
                      <td className="text-right px-3 py-2">{inr(invoice.subtotal_pre_tax)}</td>
                      <td className="text-right px-3 py-2">{inr(invoice.total_cgst)}</td>
                      <td className="text-right px-3 py-2">{inr(invoice.total_sgst)}</td>
                      <td className="text-right px-3 py-2 text-emerald-950">{inr(invoice.grand_total)}</td>
                    </tr>
                  </tfoot>
                </table>

                <div className="mt-4 p-3 bg-amber-50 border-l-4 border-amber-500 rounded">
                  <p className="text-[10px] uppercase tracking-widest text-amber-800 font-bold">Amount in Words</p>
                  <p className="font-display font-bold text-emerald-950 mt-1">{words(invoice.grand_total)}</p>
                </div>

                <div className="mt-4 flex justify-end">
                  <div className="w-full max-w-xs space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-slate-600">Delivery Charge</span><span className="font-mono">{inr(invoice.delivery_charge)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-600">Taxable Value:</span><span className="font-mono font-semibold">{inr(invoice.subtotal_pre_tax)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-600">CGST:</span><span className="font-mono">{inr(invoice.total_cgst)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-600">SGST:</span><span className="font-mono">{inr(invoice.total_sgst)}</span></div>
                    <div className="flex justify-between pt-2 border-t-2 border-emerald-900 font-display font-black text-lg">
                      <span className="text-emerald-950">Grand Total</span>
                      <span className="text-emerald-800">{inr(invoice.grand_total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-6 py-3 border-t border-black bg-white text-xs text-slate-600">
                <p className="whitespace-pre-line italic">{invoice.notes}</p>
                <p className="mt-4 text-center font-semibold text-emerald-900">Powered By Metho Logistics Private Limited</p>
              </div>

              <style>{`
                @media print {
                  @page { size: A4; margin: 8mm; }
                  body { background: white !important; }
                  #customer-invoice-print { box-shadow: none !important; border: none !important; max-width: none !important; font-size: 10px !important; }
                  #customer-invoice-print h1 { font-size: 22px !important; }
                  #customer-invoice-print .px-8 { padding-left: 4mm !important; padding-right: 4mm !important; }
                  #customer-invoice-print .py-6 { padding-top: 3mm !important; padding-bottom: 3mm !important; }
                  #customer-invoice-print .py-5 { padding-top: 2.5mm !important; padding-bottom: 2.5mm !important; }
                  #customer-invoice-print .mt-4 { margin-top: 2mm !important; }
                  #customer-invoice-print .mb-8 { margin-bottom: 4mm !important; }
                  #customer-invoice-print table { font-size: 9px !important; }
                  #customer-invoice-print th, #customer-invoice-print td { padding-top: 1.5mm !important; padding-bottom: 1.5mm !important; }
                  #customer-invoice-print { color: #000 !important; }
                  #customer-invoice-print, #customer-invoice-print * { border-color: #000 !important; box-shadow: none !important; background: #fff !important; color: #000 !important; }
                }
              `}</style>
            </div>
          );
        })() : null}
      </div>
    </div>
  );
}

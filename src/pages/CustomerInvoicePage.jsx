import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Download, Loader2, UserPlus } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";

const inr = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

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
    if (!orderId || !token) return;
    setDownloading(true);
    try {
      const { data } = await api.get(`/customer/mobile-access/orders/${orderId}/invoice/pdf`, {
        params: { token },
        responseType: "blob",
      });
      const fileName = `${invoice?.invoice_no || `INV-${orderId}`}.pdf`;
      const objectUrl = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      toast.success("Invoice PDF downloaded");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "PDF download failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <div className="max-w-4xl mx-auto px-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link to="/customer-orders" className="inline-flex items-center gap-2 text-emerald-900 hover:underline font-semibold text-sm">
            <ArrowLeft className="w-4 h-4" /> Back to Customer Orders
          </Link>
          <div className="flex gap-2">
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

        {!loading && !error && invoice ? (
          <div className="bg-white rounded-xl border border-border p-6" data-testid="customer-invoice-view">
            <div className="flex flex-wrap justify-between gap-4 border-b border-border pb-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-emerald-800 font-semibold">Invoice</p>
                <h1 className="font-display font-black text-2xl text-emerald-950 mt-1">{invoice.invoice_no}</h1>
                <p className="text-sm text-slate-600 mt-1">Order: {invoice.order_no}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">Date</p>
                <p className="text-sm font-semibold text-emerald-950">{new Date(invoice.invoice_date).toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-2">Status</p>
                <p className="text-sm font-semibold text-emerald-900 uppercase">{invoice.status}</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-wider text-slate-500">Seller</p>
                <p className="font-semibold text-emerald-950 mt-1">{invoice.seller?.name || "METHO AAY-UPAY"}</p>
                <p className="text-sm text-slate-700 mt-1">{invoice.seller?.address || ""}</p>
                <p className="text-xs text-slate-600 mt-1">GST: {invoice.seller?.gst_no || "-"}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-wider text-slate-500">Buyer</p>
                <p className="font-semibold text-emerald-950 mt-1">{invoice.buyer?.name || "Customer"}</p>
                <p className="text-sm text-slate-700 mt-1">Phone: {invoice.buyer?.phone || "-"}</p>
                <p className="text-xs text-slate-600 mt-1">Member: {invoice.buyer?.member_code || "-"}</p>
                <p className="text-xs text-slate-600 mt-1">Address: {invoice.buyer?.shipping_address || "-"}</p>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="customer-invoice-items">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-border">
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 pr-3">Qty</th>
                    <th className="py-2 pr-3">Rate</th>
                    <th className="py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(invoice.items || []).map((item, idx) => (
                    <tr key={`${item.product_code || item.product_name || "row"}-${idx}`} className="border-b border-border/60">
                      <td className="py-2 pr-3 text-slate-700">{item.product_name || "Item"}</td>
                      <td className="py-2 pr-3 text-slate-700">{item.quantity}</td>
                      <td className="py-2 pr-3 text-slate-700">{inr(item.price)}</td>
                      <td className="py-2 text-right font-semibold text-emerald-950">{inr(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end">
              <div className="w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Taxable</span>
                  <span>{inr(invoice.subtotal_pre_tax)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>CGST</span>
                  <span>{inr(invoice.total_cgst)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>SGST</span>
                  <span>{inr(invoice.total_sgst)}</span>
                </div>
                <div className="flex justify-between font-black text-emerald-950 text-base border-t border-border pt-2">
                  <span>Grand Total</span>
                  <span>{inr(invoice.grand_total)}</span>
                </div>
              </div>
            </div>

            {invoice.notes ? (
              <div className="mt-4 rounded-lg border border-border p-3 text-xs text-slate-600 whitespace-pre-line">
                {invoice.notes}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Store, TrendingUp, Percent, Package, ShoppingCart, FileText, LogOut, ScrollText, FileSpreadsheet, FileDown, Images, ReceiptText, Copy, MessageCircle, ExternalLink } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import PartnerProductForm from "@/components/PartnerProductForm";
import OfflineBillingPanel from "@/components/OfflineBillingPanel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveAssetUrl } from "@/lib/utils";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const PDF_PREVIEW = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23f1f5f9'/><rect x='80' y='50' width='240' height='300' rx='14' fill='%23ffffff' stroke='%2394a3b8' stroke-width='4'/><text x='200' y='190' text-anchor='middle' fill='%23dc2626' font-size='46' font-family='Arial' font-weight='bold'>PDF</text><text x='200' y='228' text-anchor='middle' fill='%23334155' font-size='16' font-family='Arial'>Tap to Open</text></svg>";

const pickImageUrl = (value) => {
  if (!value) return "";
  if (typeof value === "string") return resolveAssetUrl(value);
  if (typeof value === "object") {
    return resolveAssetUrl(
      value.url ||
      value.image_url ||
      value.featured_image_url ||
      value.path ||
      ""
    );
  }
  return "";
};

const normalizeFeaturedImages = (raw) => {
  const source = raw?.items ?? raw?.featured_images ?? raw;
  if (Array.isArray(source)) return source.map((u) => pickImageUrl(u)).filter(Boolean).slice(0, 5);
  if (source && typeof source === "object") {
    const ordered = [1, 2, 3, 4, 5].map((slot) => (
      source[String(slot)] ||
      source[slot] ||
      source[`featured_${slot}`] ||
      source[`featured_${slot}_url`] ||
      source[`image_${slot}`] ||
      ""
    ));
    return ordered.map((u) => pickImageUrl(u)).filter(Boolean);
  }
  return [];
};

const getPdfUrl = (product) => {
  if (!product) return "";
  if (product.pdf_url) return resolveAssetUrl(product.pdf_url);
  if (product.product_pdf_url) return resolveAssetUrl(product.product_pdf_url);
  if (Array.isArray(product.pdf_urls) && product.pdf_urls[0]) return resolveAssetUrl(product.pdf_urls[0]);
  if (Array.isArray(product.pdfs) && product.pdfs[0]) {
    const first = product.pdfs[0];
    if (typeof first === "string") return resolveAssetUrl(first);
    if (first.url) return resolveAssetUrl(first.url);
    if (first.pdf_url) return resolveAssetUrl(first.pdf_url);
  }
  return "";
};

const loadRazorpayScript = () => new Promise((resolve) => {
  if (typeof window === "undefined") return resolve(false);
  if (window.Razorpay) return resolve(true);
  const script = document.createElement("script");
  script.src = "https://checkout.razorpay.com/v1/checkout.js";
  script.async = true;
  script.onload = () => resolve(true);
  script.onerror = () => resolve(false);
  document.body.appendChild(script);
});

const Tab = ({ id, active, onClick, children }) => (
  <button onClick={() => onClick(id)} className={`px-4 py-2 rounded-full text-sm font-semibold ${active === id ? "bg-emerald-900 text-white" : "bg-white text-emerald-900 border border-emerald-200 hover:bg-emerald-50"}`} data-testid={`tab-${id}`}>{children}</button>
);

export default function PartnerDashboardPage() {
  const { user, logout } = useAuth();
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState("overview");
  const [settings, setSettings] = useState(null);
  const [paymentProfile, setPaymentProfile] = useState(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupTxn, setTopupTxn] = useState("");
  const [topupProof, setTopupProof] = useState("");
  const [uploadingProof, setUploadingProof] = useState(false);
  const [uploadingPaymentQr, setUploadingPaymentQr] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [featuredImages, setFeaturedImages] = useState([]);
  const [uploadingFeatured, setUploadingFeatured] = useState({});
  const [sendingTopup, setSendingTopup] = useState(false);
  const [sendingRazorpay, setSendingRazorpay] = useState(false);
  const [shopBannerUrl, setShopBannerUrl] = useState("");
  const [partnerUpiId, setPartnerUpiId] = useState("");
  const [savingPartnerUpi, setSavingPartnerUpi] = useState(false);

  const loadAll = () => {
    api.get("/partner/summary").then(r => setSummary(r.data)).catch(() => {});
    api.get("/partner/products").then(r => setProducts(r.data)).catch(() => {});
    api.get("/partner/ledger").then(r => setLedger(r.data)).catch(() => {});
    api.get("/partner/orders").then(r => setOrders(r.data)).catch(() => {});
    api.get("/settings").then(r => setSettings(r.data)).catch(() => setSettings(null));
    api.get("/partner/payment-profile").then(r => setPaymentProfile(r.data)).catch(() => setPaymentProfile(null));
    api.get("/partner/banner").then(r => setShopBannerUrl(resolveAssetUrl(r.data?.banner_url || ""))).catch(() => setShopBannerUrl(""));
    api.get("/partner/featured-images").then(r => setFeaturedImages(normalizeFeaturedImages(r.data))).catch(() => setFeaturedImages([]));
  };

  useEffect(() => {
    if (user?.role !== "partner") return;
    loadAll();
  }, [user]);

  useEffect(() => {
    setPartnerUpiId(paymentProfile?.partner_upi_id || "");
  }, [paymentProfile?.partner_upi_id]);

  const publicShopUrl = summary?.partner_code
    ? `${window.location.origin}/partner-shop/${encodeURIComponent(summary.partner_code)}`
    : "";

  const copyPublicShopUrl = async () => {
    if (!publicShopUrl) return;
    try {
      await navigator.clipboard.writeText(publicShopUrl);
      toast.success("Shop link copied");
    } catch {
      toast.error("Shop link copy failed");
    }
  };

  const sharePublicShopOnWhatsApp = () => {
    if (!publicShopUrl || !summary) return;
    const message = `Visit ${summary.business_name} on METHO AAY-UPAY\n${publicShopUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };

  const exportLedger = () => {
    const wb = XLSX.utils.book_new();
    const s1 = XLSX.utils.aoa_to_sheet([
      ["Partner Ledger", ""],
      ["Partner Code", summary?.partner_code], ["Business Name", summary?.business_name],
      ["Commission %", summary?.commission_percent], ["Total Sales", summary?.total_sales],
      ["Total Commission Earned", summary?.total_commission_paid],
      ["Generated", new Date().toLocaleString()], [],
    ]);
    s1["!cols"] = [{ wch: 28 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, s1, "Summary");
    const rows = [["Date", "Period", "Sales (₹)", "Rate %", "Commission (₹)"],
      ...ledger.map(e => [new Date(e.created_at).toLocaleString(), e.period, e.sales_amount, e.commission_percent, e.commission_amount]),
      [], ["TOTAL", "", ledger.reduce((s, e) => s + (e.sales_amount || 0), 0), "", ledger.reduce((s, e) => s + (e.commission_amount || 0), 0)],
    ];
    const s2 = XLSX.utils.aoa_to_sheet(rows);
    s2["!cols"] = [{ wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, s2, "Entries");
    XLSX.writeFile(wb, `Partner_${summary?.partner_code}_Ledger.xlsx`);
  };

  const openPayoutPdf = () => {
    // Opens a new tab with a print-ready payout statement
    window.open(`/partner-payout`, "_blank");
  };

  const deleteProduct = async (id) => {
    if (!window.confirm("Delete this product?")) return;
    try {
      await api.delete(`/partner/products/${id}`);
      loadAll();
    } catch {}
  };

  const uploadTopupProof = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large (max 5MB)");
      return;
    }
    setUploadingProof(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/partner/upload/topup-proof", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setTopupProof(data.url || "");
      toast.success("Proof uploaded");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Proof upload failed");
    } finally {
      setUploadingProof(false);
    }
  };

  const submitTopup = async () => {
    const amount = Number(topupAmount || 0);
    if (!amount || amount <= 0) return toast.error("Top-up amount দিন");
    if (!topupTxn.trim()) return toast.error("Transaction ID দিন");
    if (!topupProof) return toast.error("Proof upload করুন");
    setSendingTopup(true);
    try {
      await api.post("/partner/wallet/topup-request", {
        amount,
        txn_id: topupTxn.trim(),
        proof_url: topupProof,
      });
      toast.success("Top-up request sent. Admin approval pending.");
      setTopupAmount("");
      setTopupTxn("");
      setTopupProof("");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Top-up request failed");
    } finally {
      setSendingTopup(false);
    }
  };

  const submitTopupRazorpay = async () => {
    const amount = Number(topupAmount || 0);
    if (!amount || amount <= 0) return toast.error("Top-up amount দিন");

    setSendingRazorpay(true);
    try {
      const { data: created } = await api.post("/partner/wallet/topup-request", {
        amount,
        payment_method: "razorpay",
      });
      const requestId = created?.request?.id;
      if (!requestId) throw new Error("Top-up request creation failed");

      const sdkLoaded = await loadRazorpayScript();
      if (!sdkLoaded) {
        toast.error("Razorpay SDK failed to load. Please try again.");
        return;
      }

      const { data: rp } = await api.post("/partner/wallet/topup-razorpay/order", { request_id: requestId });

      const options = {
        key: rp.key_id,
        amount: rp.amount,
        currency: rp.currency || "INR",
        name: rp.name || "METHOO STORE",
        description: rp.description || "Partner wallet top-up",
        order_id: rp.razorpay_order_id,
        handler: async (resp) => {
          try {
            const { data: verified } = await api.post("/partner/wallet/topup-razorpay/verify-and-credit", {
              request_id: requestId,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            toast.success(`Wallet topped up by ${inr(verified?.request?.amount || amount)}.`, { duration: 4500 });
            setTopupAmount("");
            setTopupTxn("");
            setTopupProof("");
            loadAll();
          } catch (err) {
            toast.error(err?.response?.data?.detail || "Razorpay verification failed");
          } finally {
            setSendingRazorpay(false);
          }
        },
        modal: {
          ondismiss: () => setSendingRazorpay(false),
        },
        prefill: {
          name: summary?.business_name || user?.name || undefined,
        },
        notes: {
          partner_topup_request_id: requestId,
        },
        theme: {
          color: "#065f46",
        },
      };

      const rz = new window.Razorpay(options);
      rz.on("payment.failed", (resp) => {
        toast.error(resp?.error?.description || "Payment failed");
        setSendingRazorpay(false);
      });
      rz.open();
    } catch (err) {
      setSendingRazorpay(false);
      toast.error(err?.response?.data?.detail || err?.message || "Razorpay checkout failed");
    }
  };

  const uploadPartnerPaymentQr = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large (max 5MB)");
      return;
    }
    setUploadingPaymentQr(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post("/partner/upload/payment-qr", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Customer payment QR updated");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "QR upload failed");
    } finally {
      setUploadingPaymentQr(false);
    }
  };

  const savePartnerUpiId = async () => {
    setSavingPartnerUpi(true);
    try {
      await api.put("/partner/payment-profile", { upi_id: String(partnerUpiId || "").trim() });
      toast.success("Partner UPI ID updated");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "UPI ID update failed");
    } finally {
      setSavingPartnerUpi(false);
    }
  };

  const uploadShopBanner = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large (max 5MB)");
      return;
    }
    setUploadingBanner(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/partner/upload/shop-banner", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setShopBannerUrl(data?.url || "");
      toast.success("Shop banner uploaded");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Banner upload failed");
    } finally {
      setUploadingBanner(false);
    }
  };

  const uploadFeaturedImage = async (slot, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large (max 5MB)");
      return;
    }
    setUploadingFeatured((prev) => ({ ...prev, [slot]: true }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/partner/upload/featured-image/${slot}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setFeaturedImages(normalizeFeaturedImages(data));
      toast.success(`Featured image ${slot} uploaded`);
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Featured image upload failed");
    } finally {
      setUploadingFeatured((prev) => ({ ...prev, [slot]: false }));
    }
  };

  if (!user) return <div className="p-8 text-center">Loading...</div>;
  if (user.role !== "partner") return <Navigate to="/app" replace />;

  const manualUpiEnabled = !!settings?.manual_upi_enabled;
  const razorpayEnabled = !!settings?.razorpay_enabled && !!settings?.razorpay_key_id;

  return (
    <div className="min-h-screen bg-slate-100" data-testid="partner-dashboard">
      {/* Header */}
      <header className="bg-emerald-950 text-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-400 text-emerald-950 flex items-center justify-center"><Store className="w-5 h-5" /></div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Partner Portal</p>
              <h1 className="font-display font-black text-lg">{summary?.business_name || user.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <p className="text-[10px] text-amber-400 uppercase font-bold">Partner Code</p>
              <p className="font-mono text-sm">{summary?.partner_code}</p>
            </div>
            <Button variant="outline" size="sm" onClick={logout} className="border-white/20 bg-white/10 text-white hover:bg-white/20 rounded-full" data-testid="partner-logout">
              <LogOut className="w-4 h-4 mr-1" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-border p-4"><div className="flex items-center gap-2 text-slate-500 text-[10px] uppercase font-bold tracking-widest"><TrendingUp className="w-3.5 h-3.5" /> Total Sales</div><p className="font-display font-black text-xl text-emerald-950 mt-1">{inr(summary.total_sales)}</p></div>
            <div className="bg-white rounded-xl border border-border p-4"><div className="flex items-center gap-2 text-slate-500 text-[10px] uppercase font-bold tracking-widest"><Percent className="w-3.5 h-3.5" /> Reserve Debited</div><p className="font-display font-black text-xl text-emerald-800 mt-1">{inr(paymentProfile?.wallet?.total_debit || 0)}</p></div>
            <div className="bg-white rounded-xl border border-border p-4"><div className="flex items-center gap-2 text-slate-500 text-[10px] uppercase font-bold tracking-widest"><Package className="w-3.5 h-3.5" /> Products Linked</div><p className="font-display font-black text-xl text-emerald-950 mt-1">{summary.products_linked}</p></div>
            <div className="bg-gradient-to-br from-amber-100 to-emerald-100 rounded-xl border border-amber-300 p-4"><div className="flex items-center gap-2 text-amber-800 text-[10px] uppercase font-bold tracking-widest"><ShoppingCart className="w-3.5 h-3.5" /> This Month</div><p className="font-display font-black text-xl text-emerald-950 mt-1">{inr(summary.this_month.commission)}</p><p className="text-[10px] text-slate-600">{summary.this_month.orders} orders · {inr(summary.this_month.sales)} sales</p></div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Tab id="overview" active={tab} onClick={setTab}>Overview</Tab>
          <Tab id="products" active={tab} onClick={setTab}>Gallery Products ({products.length})</Tab>
          <Tab id="offline" active={tab} onClick={setTab}>Offline Billing</Tab>
          <Tab id="orders" active={tab} onClick={setTab}>Orders ({orders.length})</Tab>
          <Tab id="ledger" active={tab} onClick={setTab}>Ledger ({ledger.length})</Tab>
        </div>

        {tab === "overview" && summary && (
          <div className="bg-white rounded-xl border border-border p-6">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 mb-5">
              <p className="text-[10px] uppercase tracking-widest text-amber-800 font-bold">Gallery Upload Location</p>
              <h3 className="font-display font-bold text-emerald-950 text-base mt-1">Product gallery upload আগের মতোই আছে</h3>
              <p className="text-xs text-slate-700 mt-1">5টা Featured Image শুধু highlight section-এর জন্য। আসল product gallery upload করতে উপরের Gallery Products tab-এ যান।</p>
              <div className="mt-3">
                <Button
                  type="button"
                  onClick={() => setTab("products")}
                  className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full"
                  data-testid="go-to-gallery-products-tab"
                >
                  Open Gallery Product Upload
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">Shop Banner</p>
                  <h3 className="font-display font-bold text-emerald-950 text-lg">Upload one shop banner</h3>
                  <p className="text-xs text-emerald-900/80 mt-1">এখানে banner upload করলে shop page-এ দেখাবে। Product section-এ 5টির বেশি product add হবে না।</p>
                </div>
                <label className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-900 cursor-pointer hover:bg-emerald-50">
                  <input type="file" accept="image/*" onChange={uploadShopBanner} className="hidden" />
                  <Images className="w-4 h-4" /> {uploadingBanner ? "Uploading..." : "Upload Banner"}
                </label>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr] items-start">
                <div className="aspect-[16/6] rounded-xl overflow-hidden border border-emerald-200 bg-white">
                  {shopBannerUrl ? (
                    <img src={shopBannerUrl} alt="Shop banner preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-emerald-300">
                      <Images className="w-10 h-10" />
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-dashed border-emerald-300 bg-white p-3 text-xs text-slate-600 space-y-3">
                  <p>Banner size can be any image under 5MB. Featured products still remain the first 5 products in the gallery.</p>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">Your Public Shop Link</p>
                    <a
                      href={publicShopUrl || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block break-all text-sm font-semibold text-emerald-900 hover:underline"
                    >
                      {publicShopUrl || "Shop link will appear after partner code loads"}
                    </a>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={copyPublicShopUrl}
                        disabled={!publicShopUrl}
                        className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                      >
                        <Copy className="w-3.5 h-3.5 mr-1" /> Copy Link
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={sharePublicShopOnWhatsApp}
                        disabled={!publicShopUrl}
                        className="rounded-full bg-green-600 hover:bg-green-700 text-white"
                      >
                        <MessageCircle className="w-3.5 h-3.5 mr-1" /> WhatsApp Share
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        asChild
                        className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                      >
                        <a href={publicShopUrl || "#"} target="_blank" rel="noreferrer">
                          <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open Shop
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 mb-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Featured Images</p>
                  <h3 className="font-display font-bold text-emerald-950 text-lg">Upload 5 partner images</h3>
                  <p className="text-xs text-slate-600 mt-1">Shop banner-এর পাশাপাশি partner নিজে 5টা image upload করতে পারবে. এগুলো shop page-এ highlight হবে.</p>
                </div>
                <p className="text-xs text-slate-500">Max 5 images, 5MB each</p>
              </div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                {[1, 2, 3, 4, 5].map((slot) => {
                  const url = featuredImages[slot - 1] || "";
                  return (
                    <div key={slot} className="rounded-xl border border-dashed border-slate-300 p-3 bg-slate-50">
                      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Image {slot}</p>
                      <div className="aspect-square rounded-lg overflow-hidden bg-white border border-border flex items-center justify-center">
                        {url ? (
                          <img src={url} alt={`Featured ${slot}`} className="w-full h-full object-cover" />
                        ) : (
                          <Images className="w-8 h-8 text-slate-300" />
                        )}
                      </div>
                      <label className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 cursor-pointer hover:bg-emerald-50">
                        <input type="file" accept="image/*" onChange={(e) => uploadFeaturedImage(slot, e)} className="hidden" />
                        {uploadingFeatured[slot] ? "Uploading..." : (url ? "Replace Image" : "Upload Image")}
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>

            <h3 className="font-display font-bold text-emerald-950 text-lg">Partnership Agreement</h3>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><p className="text-[10px] uppercase text-slate-500 font-bold">Partner Code</p><p className="font-mono font-bold text-emerald-950">{summary.partner_code}</p></div>
              <div><p className="text-[10px] uppercase text-slate-500 font-bold">Business Name</p><p className="font-semibold text-emerald-950">{summary.business_name}</p></div>
              <div><p className="text-[10px] uppercase text-slate-500 font-bold">Commission Rate</p><p className="font-display font-black text-2xl text-amber-700">{summary.commission_percent}%</p></div>
              <div><p className="text-[10px] uppercase text-slate-500 font-bold">Current Period</p><p className="font-mono font-bold text-emerald-950">{summary.current_period}</p></div>
            </div>
            <div className="mt-6 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-900">
              প্রতি sale-এ agreed <b>{summary.commission_percent}%</b> commission প্রথমে আপনার reserve wallet থেকে debit হয়। এরপর সেই amount settings অনুযায়ী pool গুলোতে split হয় (Member/Leader/MPS/Company/Technology)।
            </div>

            <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <p className="text-[10px] uppercase tracking-widest text-amber-800 font-bold">Commission Reserve Wallet</p>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white rounded-lg border border-amber-200 p-3">
                  <p className="text-[10px] uppercase text-slate-500 font-bold">Available Balance</p>
                  <p className="font-display font-black text-2xl text-emerald-900">{inr(paymentProfile?.wallet?.balance || 0)}</p>
                </div>
                <div className="bg-white rounded-lg border border-amber-200 p-3">
                  <p className="text-[10px] uppercase text-slate-500 font-bold">Total Credit</p>
                  <p className="font-display font-black text-xl text-emerald-900">{inr(paymentProfile?.wallet?.total_credit || 0)}</p>
                </div>
                <div className="bg-white rounded-lg border border-amber-200 p-3">
                  <p className="text-[10px] uppercase text-slate-500 font-bold">Commission Debited</p>
                  <p className="font-display font-black text-xl text-emerald-900">{inr(paymentProfile?.wallet?.total_debit || 0)}</p>
                </div>
              </div>
              <p className="text-xs text-amber-900 mt-3">
                Invoice approval তখনই হবে যখন required commission reserve balance থাকবে। না থাকলে admin approve করবে না।
              </p>
            </div>

            <div className="mt-4 rounded-xl border border-border p-4 bg-white">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">Top-up METHO Commission Wallet</p>
              <p className="text-xs text-slate-600 mt-1">এই wallet recharge করলে order approval-এর সময় commission auto deduct হবে।</p>
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900" data-testid="partner-otp-safety-notice">
                <p className="font-semibold">সতর্কবার্তা: মেঠো কখনো OTP, UPI PIN, ATM PIN, CVV বা সম্পূর্ণ ব্যাংক তথ্য চায় না।</p>
                <p className="mt-1">Security Alert: METHO never asks for OTP, UPI PIN, ATM PIN, CVV, or full bank details. Do not share if anyone asks in METHO's name.</p>
              </div>

              <div className="mt-3 rounded-lg border border-border p-3 bg-slate-50">
                <p className="text-xs font-semibold text-emerald-900">Customer Payment QR (Partner)</p>
                <p className="text-[11px] text-slate-600 mt-1">Partner shop/gallery checkout-এ customer এই QR/UPI-তেই pay করবে। এটা Razorpay-এর সাথে linked নয়।</p>
                <div className="mt-2">
                  <Label htmlFor="partner-upi-id">Partner UPI ID</Label>
                  <div className="mt-1.5 flex flex-col sm:flex-row gap-2">
                    <Input
                      id="partner-upi-id"
                      value={partnerUpiId}
                      onChange={(e) => setPartnerUpiId(e.target.value)}
                      placeholder="e.g. myshop@upi"
                      className="h-10 font-mono"
                    />
                    <Button
                      type="button"
                      onClick={savePartnerUpiId}
                      disabled={savingPartnerUpi}
                      className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
                    >
                      {savingPartnerUpi ? "Saving..." : "Save UPI"}
                    </Button>
                  </div>
                </div>
                <p className="font-mono text-xs text-emerald-900 mt-2">Current UPI: {paymentProfile?.partner_upi_id || "Not set"}</p>
                {paymentProfile?.partner_qr_url ? (
                  <img
                    src={paymentProfile.partner_qr_url}
                    alt="Partner payment QR"
                    className="w-28 h-28 object-contain rounded-lg border border-border bg-white mt-2"
                  />
                ) : null}
                <div className="mt-2">
                  <input type="file" accept="image/*" onChange={uploadPartnerPaymentQr} className="block w-full text-xs" />
                  {uploadingPaymentQr ? <p className="text-xs text-slate-500 mt-1">Uploading...</p> : null}
                </div>
              </div>

              {manualUpiEnabled ? (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border p-3 bg-slate-50">
                    <p className="text-xs font-semibold text-emerald-900">Pay to METHO UPI</p>
                    <p className="text-[11px] text-slate-600 mt-1">{paymentProfile?.metho_upi_payee_name || "METHOO STORE"}</p>
                    <p className="font-mono text-sm text-emerald-900 mt-1">{paymentProfile?.metho_upi_id || "Not set"}</p>
                    {(paymentProfile?.metho_topup_qr_url || paymentProfile?.metho_upi_qr_url) && (
                      <img
                        src={paymentProfile?.metho_topup_qr_url || paymentProfile?.metho_upi_qr_url}
                        alt="METHO topup QR"
                        className="w-28 h-28 object-contain rounded-lg border border-border bg-white mt-2"
                      />
                    )}
                    {(paymentProfile?.metho_bank_account_holder || paymentProfile?.metho_bank_name || paymentProfile?.metho_bank_account_number || paymentProfile?.metho_bank_ifsc) ? (
                      <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] text-emerald-900">
                        <p className="font-semibold">METHO Bank Account</p>
                        {paymentProfile?.metho_bank_account_holder ? <p>Holder: {paymentProfile.metho_bank_account_holder}</p> : null}
                        {paymentProfile?.metho_bank_name ? <p>Bank: {paymentProfile.metho_bank_name}</p> : null}
                        {paymentProfile?.metho_bank_branch ? <p>Branch: {paymentProfile.metho_bank_branch}</p> : null}
                        {paymentProfile?.metho_bank_account_number ? <p className="font-mono">A/C: {paymentProfile.metho_bank_account_number}</p> : null}
                        {paymentProfile?.metho_bank_ifsc ? <p className="font-mono">IFSC: {paymentProfile.metho_bank_ifsc}</p> : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <div>
                      <Label>Top-up Amount</Label>
                      <Input value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} type="number" min="1" className="mt-1.5 h-10" placeholder="e.g. 500" />
                    </div>
                    <div>
                      <Label>UPI Transaction ID</Label>
                      <Input value={topupTxn} onChange={(e) => setTopupTxn(e.target.value)} className="mt-1.5 h-10 font-mono" placeholder="Required for manual proof top-up" />
                    </div>
                    <div>
                      <Label>Payment Proof Screenshot</Label>
                      <input type="file" accept="image/*" onChange={uploadTopupProof} className="mt-1.5 block w-full text-xs" />
                      {uploadingProof && <p className="text-xs text-slate-500 mt-1">Uploading...</p>}
                      {topupProof && <p className="text-xs text-emerald-700 mt-1">Proof uploaded</p>}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button onClick={submitTopup} disabled={sendingTopup || uploadingProof || sendingRazorpay} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="partner-topup-request-btn">
                        {sendingTopup ? "Submitting..." : "Submit Manual Proof Top-up"}
                      </Button>
                      {razorpayEnabled ? (
                        <Button onClick={submitTopupRazorpay} disabled={sendingTopup || sendingRazorpay} variant="outline" className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50" data-testid="partner-topup-razorpay-btn">
                          {sendingRazorpay ? "Opening Razorpay..." : `Pay with Razorpay · ${topupAmount ? inr(topupAmount) : "₹0"}`}
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {razorpayEnabled ? "Use Razorpay for instant credit, or submit manual proof if you prefer the UPI QR flow." : "Razorpay currently disabled in settings. Manual proof flow is active."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Manual UPI proof flow is hidden by admin. Use Razorpay below if it is enabled.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "products" && (
          <div className="bg-white rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-emerald-950 text-lg">Gallery Product/Service Upload</h3>
              <div className="flex items-center gap-2">
                {summary?.partner_code && (
                  <Link to={`/gallery/${summary.partner_code}`} target="_blank">
                    <Button size="sm" variant="outline" className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50" data-testid="open-gallery-auto-pdf">
                      <Images className="w-4 h-4 mr-1" /> View Gallery
                    </Button>
                  </Link>
                )}
                {summary?.partner_code && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50"
                    onClick={() => {
                      const pdfLink = `${window.location.origin}/gallery/${summary.partner_code}?autoPdf=1`;
                      const text = `METHO Product PDF Catalog\n\n${pdfLink}`;
                      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
                    }}
                    data-testid="share-gallery-pdf-whatsapp"
                  >
                    <Images className="w-4 h-4 mr-1" /> Share PDF on WhatsApp
                  </Button>
                )}
                <PartnerProductForm onSaved={loadAll} />
              </div>
            </div>
            <p className="mb-4 text-xs text-slate-600">
              Partner এক এক করে product/service (name, rate, stock/capacity, image) upload করবে। View Gallery এ listing দেখবেন; Share PDF on WhatsApp এ PDF link পাঠাতে পারবেন।
            </p>
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground">No listing yet. Click "Add to Gallery" to upload your first product or service.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {products.map(p => (
                  <div key={p.id} className="rounded-lg border border-border overflow-hidden">
                    <div className="aspect-square bg-secondary relative">
                      <img src={resolveAssetUrl(p.image_url) || (getPdfUrl(p) ? PDF_PREVIEW : undefined)} alt={p.name} className="w-full h-full object-cover" />
                      {getPdfUrl(p) ? (
                        <button
                          type="button"
                          onClick={() => window.open(getPdfUrl(p), "_blank")}
                          className="absolute left-2 top-2 rounded-full bg-white/90 text-emerald-900 px-2.5 py-1 text-[10px] font-bold"
                        >
                          Open PDF
                        </button>
                      ) : null}
                    </div>
                    <div className="p-3"><p className="font-semibold text-sm text-emerald-950">{p.name}</p><p className="text-xs text-muted-foreground">{p.category}</p><p className="font-display font-black text-emerald-800 mt-1">₹{p.price}</p><p className="text-[10px] text-slate-500">{(String(p?.listing_type || p?.item_kind || "").toLowerCase().includes("service") || p?.is_service) ? "Service" : `Stock: ${p.stock}`}</p>
                    <div className="flex gap-1 mt-2">
                      <PartnerProductForm product={p} onSaved={loadAll} />
                      <Button size="sm" variant="outline" className="rounded-full border-red-300 text-red-700 hover:bg-red-50 h-7 px-2 text-[11px]" onClick={() => deleteProduct(p.id)} data-testid={`del-my-product-${p.id}`}>Delete</Button>
                    </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "offline" && (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-center gap-2">
              <ReceiptText className="w-3.5 h-3.5" />
              Member ID দিন, product select করুন, quantity লিখুন, payment mode cash/online দিয়ে instant invoice generate করুন।
            </div>
            <OfflineBillingPanel title="Partner Counter Billing" />
          </div>
        )}

        {tab === "ledger" && (
          <div className="bg-white rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><ScrollText className="w-4 h-4 text-emerald-700" /><h3 className="font-display font-bold text-emerald-950 text-lg">Commission Ledger</h3></div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={exportLedger} className="rounded-full border-emerald-800 text-emerald-900" data-testid="partner-excel-btn">
                  <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
                </Button>
                <Button size="sm" variant="outline" onClick={openPayoutPdf} className="rounded-full border-emerald-800 text-emerald-900" data-testid="partner-pdf-btn">
                  <FileDown className="w-4 h-4 mr-1" /> Payout PDF
                </Button>
              </div>
            </div>
            {ledger.length === 0 ? (
              <p className="text-sm text-muted-foreground">No entries yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left">
                  <tr><th className="px-3 py-2 text-xs uppercase">Date</th><th className="px-3 py-2 text-xs uppercase">Period</th><th className="text-right px-3 py-2 text-xs uppercase">Sales</th><th className="text-right px-3 py-2 text-xs uppercase">Rate</th><th className="text-right px-3 py-2 text-xs uppercase">Commission</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ledger.map((e, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-xs">{new Date(e.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.period}</td>
                      <td className="text-right px-3 py-2">{inr(e.sales_amount)}</td>
                      <td className="text-right px-3 py-2">{e.commission_percent}%</td>
                      <td className="text-right px-3 py-2 font-semibold text-emerald-800">{inr(e.commission_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "orders" && (
          <div className="bg-white rounded-xl border border-border p-6">
            <h3 className="font-display font-bold text-emerald-950 text-lg mb-4">Orders including your products</h3>
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <div className="space-y-3">
                {orders.map(o => (
                  <div key={o.id} className="border border-border rounded-lg p-4 flex flex-wrap justify-between gap-3" data-testid={`partner-order-${o.id}`}>
                    <div>
                      <p className="font-mono text-xs text-emerald-800">{o.order_no}</p>
                      <p className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString()}</p>
                      <div className="mt-2 space-y-1">
                        {o.my_items?.map((it, i) => (
                          <p key={i} className="text-sm">• {it.product_name} × {it.quantity} = ₹{it.subtotal}</p>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-slate-500 font-bold">Your Commission</p>
                      <p className="font-display font-black text-2xl text-emerald-800">{inr(o.my_commission)}</p>
                      <p className="text-[10px] text-slate-500">Sales: {inr(o.my_sales)} · Status: <b className="uppercase">{o.status}</b></p>
                      <Link to={`/invoice/${o.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-emerald-800 hover:underline mt-1">
                        <FileText className="w-3 h-3" /> View Invoice
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}


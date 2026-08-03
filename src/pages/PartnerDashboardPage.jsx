import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Store, TrendingUp, Percent, Package, ShoppingCart, FileText, LogOut, ScrollText, FileSpreadsheet, FileDown, Images, ReceiptText, Copy, MessageCircle, ExternalLink, CarTaxiFront, PlayCircle, CheckCircle2, Wallet } from "lucide-react";
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
const withUnit = (price, unitType) => {
  const unit = String(unitType || "piece").trim().toLowerCase() || "piece";
  return unit === "piece" ? inr(price) : `${inr(price)} / ${unit}`;
};
const routeMapsUrl = (pickup, destination) => {
  const origin = String(pickup || "").trim();
  const dest = String(destination || "").trim();
  if (!origin && !dest) return "";
  if (!dest) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(origin)}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=driving`;
};
const isTransportServiceListing = (item) => {
  const key = String(item?.service_template_key || "").trim().toLowerCase();
  if (["cab_airport_drop", "car_rental_daily", "bike_rental_daily"].includes(key)) return true;
  const haystack = [item?.category, item?.name, item?.description]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  return ["transport", "cab", "taxi", "bike rental", "car rental", "ride"].some((k) => haystack.includes(k));
};
const HOSPITALITY_SERVICE_SECTORS = ["Hotel", "Homestay", "Restaurant", "Cafe"];
const DOORSTEP_SERVICE_SECTORS = ["Home Service", "Laundry", "Beauty at Home", "Cleaning", "Courier", "Tailoring"];
const isHospitalityServiceListing = (item) => {
  const key = String(item?.service_template_key || "").trim().toLowerCase();
  if (["hotel_standard_room", "hotel_deluxe_room", "hotel_suite_room", "homestay_daily_stay", "homestay_weekend_package", "restaurant_table_booking", "banquet_slot", "restaurant_takeaway_slot", "cafe_table_reservation"].includes(key)) return true;
  const haystack = [item?.category, item?.name, item?.description]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  return ["hotel", "homestay", "restaurant", "banquet", "cafe", "room booking", "table booking", "takeaway", "daily stay", "weekend package"].some((k) => haystack.includes(k));
};
const isDoorstepServiceListing = (item) => {
  const key = String(item?.service_template_key || "").trim().toLowerCase();
  if (["ac_service_visit", "plumbing_repair", "electrician_visit", "appliance_repair", "laundry_kg_service", "dry_clean_service", "tailoring_stitching", "beauty_home_service", "courier_pickup", "house_deep_clean", "office_cleaning", "pest_control_visit"].includes(key)) return true;
  const haystack = [item?.category, item?.name, item?.description]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  return ["home repair", "home service", "laundry", "dry clean", "tailoring", "beauty", "courier", "cleaning", "pest control", "electrician", "plumbing", "appliance repair"].some((k) => haystack.includes(k));
};
const PARTNER_IMAGE_MAX_BYTES = 200 * 1024;
const PARTNER_IMAGE_MAX_TEXT = "200KB";
const PDF_PREVIEW = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23f1f5f9'/><rect x='80' y='50' width='240' height='300' rx='14' fill='%23ffffff' stroke='%2394a3b8' stroke-width='4'/><text x='200' y='190' text-anchor='middle' fill='%23dc2626' font-size='46' font-family='Arial' font-weight='bold'>PDF</text><text x='200' y='228' text-anchor='middle' fill='%23334155' font-size='16' font-family='Arial'>Tap to Open</text></svg>";

const isLikelyAssetRef = (value) => {
  const s = String(value || "").trim();
  if (!s) return false;
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:") || s.startsWith("blob:")) return true;
  if (s.startsWith("/")) return true;
  return /(media\/|uploads\/|static\/|\.(png|jpe?g|webp|gif|svg|pdf)(\?|$))/i.test(s);
};

const firstValidAssetRef = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && isLikelyAssetRef(value)) return resolveAssetUrl(value);
  }
  return "";
};

const pickImageUrl = (value) => {
  if (!value) return "";
  if (typeof value === "string") return firstValidAssetRef(value);
  if (typeof value === "object") {
    return firstValidAssetRef(
      value.url ||
      value.image_url ||
      value.featured_image_url ||
      value.path ||
      value.file_url ||
      value.public_url ||
      value.secure_url ||
      value.src ||
      value.image ||
      value.link ||
      ""
    );
  }
  return "";
};

const normalizeFeaturedImages = (raw) => {
  const source = raw?.items ?? raw?.featured_images ?? raw;
  if (Array.isArray(source)) {
    const items = ["", "", "", "", ""];
    for (let idx = 0; idx < Math.min(5, source.length); idx += 1) {
      items[idx] = pickImageUrl(source[idx]);
    }
    return items;
  }
  if (source && typeof source === "object") {
    const ordered = [1, 2, 3, 4, 5].map((slot) => (
      source[String(slot)] ||
      source[slot] ||
      source[`featured_${slot}`] ||
      source[`featured_${slot}_url`] ||
      source[`image_${slot}`] ||
      source[`slot_${slot}`] ||
      source[`slot_${slot}_url`] ||
      ""
    ));
    return ordered.map((u) => pickImageUrl(u));
  }
  return ["", "", "", "", ""];
};

const mergeFeaturedBySlot = (current, slot, nextUrl) => {
  const items = Array.isArray(current) ? [...current] : ["", "", "", "", ""];
  while (items.length < 5) items.push("");
  if (slot >= 1 && slot <= 5) items[slot - 1] = pickImageUrl(nextUrl);
  return items.slice(0, 5);
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
  const [transportData, setTransportData] = useState({ items: [], wallet: { balance: 0 } });
  const [loadingTransport, setLoadingTransport] = useState(false);
  const [fareDrafts, setFareDrafts] = useState({});
  const [txnDrafts, setTxnDrafts] = useState({});
  const [transportPresets, setTransportPresets] = useState([]);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetForm, setPresetForm] = useState({ service_product_id: "", destination: "", fare: "", pickup_hint: "", notes: "" });
  const productItems = products.filter((p) => !(String(p?.listing_type || p?.item_kind || "").toLowerCase().includes("service") || p?.is_service));
  const transportItems = products.filter((p) => (String(p?.listing_type || p?.item_kind || "").toLowerCase().includes("service") || p?.is_service) && isTransportServiceListing(p));
  const hospitalityItems = products.filter((p) => (String(p?.listing_type || p?.item_kind || "").toLowerCase().includes("service") || p?.is_service) && !isTransportServiceListing(p) && isHospitalityServiceListing(p));
  const doorstepItems = products.filter((p) => (String(p?.listing_type || p?.item_kind || "").toLowerCase().includes("service") || p?.is_service) && !isTransportServiceListing(p) && !isHospitalityServiceListing(p) && isDoorstepServiceListing(p));
  const serviceItems = products.filter((p) => (String(p?.listing_type || p?.item_kind || "").toLowerCase().includes("service") || p?.is_service) && !isTransportServiceListing(p) && !isHospitalityServiceListing(p) && !isDoorstepServiceListing(p));

  const loadAll = () => {
    api.get("/partner/summary").then(r => setSummary(r.data)).catch(() => {});
    api.get("/partner/products").then(r => setProducts(r.data)).catch(() => {});
    api.get("/partner/ledger").then(r => setLedger(r.data)).catch(() => {});
    api.get("/partner/orders").then(r => setOrders(r.data)).catch(() => {});
    api.get("/settings").then(r => setSettings(r.data)).catch(() => setSettings(null));
    api.get("/partner/payment-profile").then(r => setPaymentProfile(r.data)).catch(() => setPaymentProfile(null));
    api.get("/partner/banner").then(r => setShopBannerUrl(resolveAssetUrl(r.data?.banner_url || ""))).catch(() => setShopBannerUrl(""));
    api.get("/partner/featured-images").then(r => {
      const normalized = normalizeFeaturedImages(r.data);
      setFeaturedImages(normalized);
    }).catch(() => {
      // Keep current UI state if reload fails; avoid wiping freshly uploaded previews.
    });
    api.get("/partner/transport/fare-presets").then((r) => setTransportPresets(Array.isArray(r.data?.items) ? r.data.items : [])).catch(() => setTransportPresets([]));
    setLoadingTransport(true);
    api.get("/partner/transport/bookings").then((r) => setTransportData(r.data || { items: [], wallet: { balance: 0 } })).catch(() => setTransportData({ items: [], wallet: { balance: 0 } })).finally(() => setLoadingTransport(false));
  };

  const updateTripFare = async (tripId) => {
    const nextFare = Number(fareDrafts?.[tripId] || 0);
    if (!nextFare || nextFare <= 0) {
      toast.error("Valid fare দিন");
      return;
    }
    try {
      await api.post(`/partner/transport/bookings/${tripId}/fare`, { fare_final: nextFare });
      toast.success("Fare updated");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Fare update failed");
    }
  };

  const confirmTripBooking = async (tripId) => {
    try {
      await api.post(`/partner/transport/bookings/${tripId}/confirm`, {});
      toast.success("Final fare locked, reserve debited, and trip auto-approved");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Booking confirmation failed");
    }
  };

  const startTrip = async (tripId) => {
    try {
      await api.post(`/partner/transport/bookings/${tripId}/start`, {});
      toast.success("Trip started");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Trip start failed");
    }
  };

  const completeTrip = async (tripId) => {
    try {
      await api.post(`/partner/transport/bookings/${tripId}/complete`, {});
      toast.success("Trip completed. Show QR for payment.");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Trip complete failed");
    }
  };

  const markTripPaid = async (tripId) => {
    const txn = String(txnDrafts?.[tripId] || "").trim();
    if (!txn) {
      toast.error("Transaction ID দিন");
      return;
    }
    try {
      await api.post(`/partner/transport/bookings/${tripId}/mark-paid`, { txn_id: txn });
      toast.success("Payment marked. Admin approval pending.");
      setTxnDrafts((prev) => ({ ...prev, [tripId]: "" }));
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Payment mark failed");
    }
  };

  const transportServices = React.useMemo(() => products.filter((p) => isTransportServiceListing(p)), [products]);

  useEffect(() => {
    if (!transportServices.length) return;
    setPresetForm((prev) => {
      if (prev.service_product_id) return prev;
      return { ...prev, service_product_id: String(transportServices[0].id || "") };
    });
  }, [transportServices]);

  const saveFarePreset = async () => {
    const destination = String(presetForm.destination || "").trim();
    const fare = Number(presetForm.fare || 0);
    if (!presetForm.service_product_id) return toast.error("Transport service select করুন");
    if (!destination) return toast.error("Destination দিন");
    if (!fare || fare <= 0) return toast.error("Valid preset fare দিন");
    setPresetBusy(true);
    try {
      const { data } = await api.post("/partner/transport/fare-presets", {
        service_product_id: presetForm.service_product_id,
        destination,
        fare,
        pickup_hint: String(presetForm.pickup_hint || "").trim(),
        notes: String(presetForm.notes || "").trim(),
      });
      setTransportPresets(Array.isArray(data?.items) ? data.items : []);
      setPresetForm((prev) => ({ ...prev, destination: "", fare: "", pickup_hint: "", notes: "" }));
      toast.success("Preset fare saved");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Preset save failed");
    } finally {
      setPresetBusy(false);
    }
  };

  const deleteFarePreset = async (presetId) => {
    if (!window.confirm("Delete this preset fare?")) return;
    try {
      const { data } = await api.delete(`/partner/transport/fare-presets/${presetId}`);
      setTransportPresets(Array.isArray(data?.items) ? data.items : []);
      toast.success("Preset deleted");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Preset delete failed");
    }
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
  const isServicePartner = String(summary?.business_type || summary?.business_name || "").toLowerCase().includes("service");

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
    if (file.size > PARTNER_IMAGE_MAX_BYTES) {
      toast.error(`File too large (max ${PARTNER_IMAGE_MAX_TEXT})`);
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
    if (file.size > PARTNER_IMAGE_MAX_BYTES) {
      toast.error(`File too large (max ${PARTNER_IMAGE_MAX_TEXT})`);
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
    if (file.size > PARTNER_IMAGE_MAX_BYTES) {
      toast.error(`File too large (max ${PARTNER_IMAGE_MAX_TEXT})`);
      return;
    }
    setUploadingBanner(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/partner/upload/shop-banner", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setShopBannerUrl(resolveAssetUrl(data?.url || ""));
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
    if (file.size > PARTNER_IMAGE_MAX_BYTES) {
      toast.error(`File too large (max ${PARTNER_IMAGE_MAX_TEXT})`);
      return;
    }
    setUploadingFeatured((prev) => ({ ...prev, [slot]: true }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/partner/upload/featured-image/${slot}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const normalized = normalizeFeaturedImages(data);
      const hasAnyImage = normalized.some(Boolean);
      if (hasAnyImage) {
        setFeaturedImages(normalized);
      } else {
        const directUrl = data?.url || data?.image_url || data?.file_url || data?.path || "";
        setFeaturedImages((prev) => mergeFeaturedBySlot(prev, slot, directUrl));
      }
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
          <Tab id="products" active={tab} onClick={setTab}>Products ({productItems.length})</Tab>
          <Tab id="transport" active={tab} onClick={setTab}>Transport ({transportItems.length})</Tab>
          <Tab id="stay-dining" active={tab} onClick={setTab}>Stay & Dining ({hospitalityItems.length})</Tab>
          <Tab id="doorstep" active={tab} onClick={setTab}>Doorstep ({doorstepItems.length})</Tab>
          <Tab id="services" active={tab} onClick={setTab}>Other Services ({serviceItems.length})</Tab>
          <Tab id="offline" active={tab} onClick={setTab}>Offline Billing</Tab>
          <Tab id="orders" active={tab} onClick={setTab}>Orders ({orders.length})</Tab>
          <Tab id="ledger" active={tab} onClick={setTab}>Ledger ({ledger.length})</Tab>
        </div>

        {tab === "overview" && summary && (
          <div className="bg-white rounded-xl border border-border p-6">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 mb-5">
              <p className="text-[10px] uppercase tracking-widest text-amber-800 font-bold">Listing Manager</p>
              <h3 className="font-display font-bold text-emerald-950 text-base mt-1">Shop listing manage এখান থেকেই করুন</h3>
              <p className="text-xs text-slate-700 mt-1">Product, transport, stay-dining, doorstep, আর other service এখন আলাদা tab-এ থাকবে, তাই mix হবে না।</p>
              <div className="mt-3">
                <Button
                  type="button"
                  onClick={() => setTab("products")}
                  className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full"
                  data-testid="go-to-gallery-products-tab"
                >
                  Open Listing Manager
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">Shop Banner</p>
                  <h3 className="font-display font-bold text-emerald-950 text-lg">Upload one shop banner</h3>
                  <p className="text-xs text-emerald-900/80 mt-1">এখানে banner upload করলে public shop/service page-এ দেখাবে।</p>
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
                  <p>Banner size can be any image under 200KB. Featured images are only for highlight/branding.</p>
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

            <div className="rounded-xl border border-slate-200 bg-white p-4 mb-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Featured Images</p>
                  <h3 className="font-display font-bold text-emerald-950 text-lg">Upload 5 partner images</h3>
                  <p className="text-xs text-slate-600 mt-1">Shop banner-এর পাশাপাশি partner নিজে 5টা image upload করতে পারবে. এগুলো shop page-এ highlight হবে.</p>
                </div>
                <p className="text-xs text-slate-500">Max 5 images, 200KB each</p>
              </div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                {[1, 2, 3, 4, 5].map((slot) => {
                  const url = featuredImages[slot - 1] || "";
                  return (
                    <div key={slot} className="rounded-xl border border-dashed border-slate-300 p-3 bg-slate-50">
                      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Image {slot}</p>
                      <div className="aspect-square rounded-lg overflow-hidden bg-white border border-border flex items-center justify-center">
                        {url ? (
                          <img
                            src={url}
                            alt={`Featured ${slot}`}
                            className="w-full h-full object-cover"
                            onError={() => {
                              setFeaturedImages((prev) => {
                                const next = Array.isArray(prev) ? [...prev] : ["", "", "", "", ""];
                                while (next.length < 5) next.push("");
                                next[slot - 1] = "";
                                return next;
                              });
                            }}
                          />
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
                  <p>Manual UPI proof flow is hidden by admin.</p>
                  {razorpayEnabled ? (
                    <div className="mt-3 space-y-2">
                      <div>
                        <Label>Top-up Amount</Label>
                        <Input value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} type="number" min="1" className="mt-1.5 h-10" placeholder="e.g. 500" />
                      </div>
                      <Button onClick={submitTopupRazorpay} disabled={sendingRazorpay} variant="outline" className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50" data-testid="partner-topup-razorpay-btn-only">
                        {sendingRazorpay ? "Opening Razorpay..." : `Pay with Razorpay · ${topupAmount ? inr(topupAmount) : "₹0"}`}
                      </Button>
                      <p className="text-[11px] text-slate-600">Razorpay checkout-এ UPI collect/scan সহ যেকোনো available mode দিয়ে top-up দিতে পারবেন।</p>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px]">Razorpay is currently disabled in settings.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "products" && (
          <div className="bg-white rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-emerald-950 text-lg">Product Listings</h3>
              <div className="flex items-center gap-2">
                {summary?.partner_code && (
                  <Link to={`/gallery/${summary.partner_code}?tab=products`} target="_blank">
                    <Button size="sm" variant="outline" className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50" data-testid="open-gallery-auto-pdf">
                      <Images className="w-4 h-4 mr-1" /> View Product Gallery
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
                    <Images className="w-4 h-4 mr-1" /> Share Product PDF on WhatsApp
                  </Button>
                )}
                <PartnerProductForm
                  onSaved={loadAll}
                  defaultListingType="product"
                  fixedListingType="product"
                  triggerLabel="Add Product"
                  dialogTitle="New Product"
                  dialogDescription="Create a product listing only. Service or transport options are not shown in this form."
                />
              </div>
            </div>
            <p className="mb-4 text-xs text-slate-600">
              এখান থেকে product add/edit করুন।
            </p>
            {productItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No product yet. Click "Add Listing" to create your first product.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {productItems.map(p => (
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
                    <div className="p-3"><p className="font-semibold text-sm text-emerald-950">{p.name}</p><p className="text-xs text-muted-foreground">{p.category}</p><p className="font-display font-black text-emerald-800 mt-1">{withUnit(p.price, p.unit_type)}</p><p className="text-[10px] text-slate-500">Stock: {p.stock}</p>
                    <div className="flex gap-1 mt-2">
                      <PartnerProductForm
                        product={p}
                        onSaved={loadAll}
                        fixedListingType="product"
                        triggerLabel="Edit Product"
                        dialogTitle="Edit Product"
                        dialogDescription="Update only this product listing. Service or transport options are hidden here."
                      />
                      <Button size="sm" variant="outline" className="rounded-full border-red-300 text-red-700 hover:bg-red-50 h-7 px-2 text-[11px]" onClick={() => deleteProduct(p.id)} data-testid={`del-my-product-${p.id}`}>Delete</Button>
                    </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "stay-dining" && (
          <div className="bg-white rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-emerald-950 text-lg">Stay & Dining Listings</h3>
              <div className="flex items-center gap-2">
                {summary?.partner_code && (
                  <Link to={`/gallery/${summary.partner_code}?tab=stay-dining`} target="_blank">
                    <Button size="sm" variant="outline" className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50">
                      <Images className="w-4 h-4 mr-1" /> View Stay & Dining
                    </Button>
                  </Link>
                )}
                <PartnerProductForm
                  onSaved={loadAll}
                  defaultListingType="service"
                  fixedListingType="service"
                  allowedServiceSectors={HOSPITALITY_SERVICE_SECTORS}
                  initialServiceSectorFilter="Hotel"
                  triggerLabel="Add Stay/Dining"
                  dialogTitle="New Stay & Dining Service"
                  dialogDescription="Create only hotel, homestay, restaurant, cafe, and similar stay-dining services here."
                />
              </div>
            </div>
            <p className="mb-4 text-xs text-slate-600">
              এখান থেকে শুধু hotel, homestay, restaurant, cafe type service add/edit করুন।
            </p>
            {hospitalityItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stay/dining service yet. Click "Add Stay/Dining" to create one.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {hospitalityItems.map(p => (
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
                    <div className="p-3"><p className="font-semibold text-sm text-emerald-950">{p.name}</p><p className="text-xs text-muted-foreground">{p.category}</p><p className="font-display font-black text-emerald-800 mt-1">{withUnit(p.price, p.unit_type)}</p><p className="text-[10px] text-slate-500">{String(p?.service_invoice_mode || "detailed").replace(/_/g, " ")}</p>
                    <div className="flex gap-1 mt-2">
                      <PartnerProductForm
                        product={p}
                        onSaved={loadAll}
                        fixedListingType="service"
                        allowedServiceSectors={HOSPITALITY_SERVICE_SECTORS}
                        initialServiceSectorFilter="Hotel"
                        triggerLabel="Edit Stay/Dining"
                        dialogTitle="Edit Stay & Dining Service"
                        dialogDescription="Update only this hotel, homestay, restaurant, or cafe service."
                      />
                      <Button size="sm" variant="outline" className="rounded-full border-red-300 text-red-700 hover:bg-red-50 h-7 px-2 text-[11px]" onClick={() => deleteProduct(p.id)} data-testid={`del-my-hospitality-${p.id}`}>Delete</Button>
                    </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "doorstep" && (
          <div className="bg-white rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-emerald-950 text-lg">Doorstep Service Listings</h3>
              <div className="flex items-center gap-2">
                {summary?.partner_code && (
                  <Link to={`/gallery/${summary.partner_code}?tab=doorstep`} target="_blank">
                    <Button size="sm" variant="outline" className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50">
                      <Images className="w-4 h-4 mr-1" /> View Doorstep Services
                    </Button>
                  </Link>
                )}
                <PartnerProductForm
                  onSaved={loadAll}
                  defaultListingType="service"
                  fixedListingType="service"
                  allowedServiceSectors={DOORSTEP_SERVICE_SECTORS}
                  initialServiceSectorFilter="Home Service"
                  triggerLabel="Add Doorstep"
                  dialogTitle="New Doorstep Service"
                  dialogDescription="Create only doorstep/home-visit service listings here."
                />
              </div>
            </div>
            <p className="mb-4 text-xs text-slate-600">
              এখান থেকে শুধু home service, laundry, cleaning, beauty at home, courier, tailoring type service add/edit করুন।
            </p>
            {doorstepItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No doorstep service yet. Click "Add Doorstep" to create one.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {doorstepItems.map(p => (
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
                    <div className="p-3"><p className="font-semibold text-sm text-emerald-950">{p.name}</p><p className="text-xs text-muted-foreground">{p.category}</p><p className="font-display font-black text-emerald-800 mt-1">{withUnit(p.price, p.unit_type)}</p><p className="text-[10px] text-slate-500">{String(p?.service_invoice_mode || "detailed").replace(/_/g, " ")}</p>
                    <div className="flex gap-1 mt-2">
                      <PartnerProductForm
                        product={p}
                        onSaved={loadAll}
                        fixedListingType="service"
                        allowedServiceSectors={DOORSTEP_SERVICE_SECTORS}
                        initialServiceSectorFilter="Home Service"
                        triggerLabel="Edit Doorstep"
                        dialogTitle="Edit Doorstep Service"
                        dialogDescription="Update only this doorstep/home-visit service."
                      />
                      <Button size="sm" variant="outline" className="rounded-full border-red-300 text-red-700 hover:bg-red-50 h-7 px-2 text-[11px]" onClick={() => deleteProduct(p.id)} data-testid={`del-my-doorstep-${p.id}`}>Delete</Button>
                    </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "services" && (
          <div className="bg-white rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-emerald-950 text-lg">Other Service Listings</h3>
              <div className="flex items-center gap-2">
                {summary?.partner_code && (
                  <Link to={`/gallery/${summary.partner_code}?tab=other-services`} target="_blank">
                    <Button size="sm" variant="outline" className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50">
                      <Images className="w-4 h-4 mr-1" /> View Other Services
                    </Button>
                  </Link>
                )}
                <PartnerProductForm
                  onSaved={loadAll}
                  defaultListingType="service"
                  fixedListingType="service"
                  excludedServiceSectors={["Transport", "Logistics", ...HOSPITALITY_SERVICE_SECTORS, ...DOORSTEP_SERVICE_SECTORS]}
                  triggerLabel="Add Other Service"
                  dialogTitle="New Other Service"
                  dialogDescription="Create only non-transport, non-hospitality, non-doorstep service listings here."
                />
              </div>
            </div>
            <p className="mb-4 text-xs text-slate-600">
              এখান থেকে clinic, education, legal, accounting, fitness, photography, travel, repair center ইত্যাদি other service add/edit করুন।
            </p>
            {serviceItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No other service yet. Click "Add Other Service" to create one.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {serviceItems.map(p => (
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
                    <div className="p-3"><p className="font-semibold text-sm text-emerald-950">{p.name}</p><p className="text-xs text-muted-foreground">{p.category}</p><p className="font-display font-black text-emerald-800 mt-1">{withUnit(p.price, p.unit_type)}</p><p className="text-[10px] text-slate-500">{String(p?.service_invoice_mode || "detailed").replace(/_/g, " ")}</p>
                    <div className="flex gap-1 mt-2">
                      <PartnerProductForm
                        product={p}
                        onSaved={loadAll}
                        fixedListingType="service"
                        excludedServiceSectors={["Transport", "Logistics", ...HOSPITALITY_SERVICE_SECTORS, ...DOORSTEP_SERVICE_SECTORS]}
                        triggerLabel="Edit Other Service"
                        dialogTitle="Edit Other Service"
                        dialogDescription="Update only this other-service listing. Transport, stay-dining, and doorstep templates are hidden here."
                      />
                      <Button size="sm" variant="outline" className="rounded-full border-red-300 text-red-700 hover:bg-red-50 h-7 px-2 text-[11px]" onClick={() => deleteProduct(p.id)} data-testid={`del-my-product-${p.id}`}>Delete</Button>
                    </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "transport" && (
          <div className="bg-white rounded-xl border border-border p-6" data-testid="partner-transport-tab">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Transport Hub</p>
                <h3 className="font-display font-bold text-emerald-950 text-lg mt-1 inline-flex items-center gap-2"><CarTaxiFront className="w-4 h-4" /> Cab / Car Rental / Bike Rental Control Room</h3>
                <p className="text-xs text-slate-600 mt-1">Transport service listing, fare lock, reserve debit, auto approval, and trip queue সবকিছু এই tab-এই থাকবে.</p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 inline-flex items-center gap-2">
                <Wallet className="w-4 h-4" /> Wallet Balance: {inr(transportData?.wallet?.balance || 0)}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-4">
              <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-sky-700 font-semibold">Transport Listings</p>
                    <h4 className="font-display font-bold text-emerald-950 text-base mt-1">Add and manage ride/rental services only</h4>
                    <p className="text-xs text-slate-600 mt-1">এখান থেকে শুধু cab, car rental, bike rental, mini cargo ধরনের transport listing manage করুন। এগুলো service tab-এ যাবে না।</p>
                  </div>
                  <PartnerProductForm
                    onSaved={loadAll}
                    defaultListingType="service"
                    fixedListingType="service"
                    allowedServiceSectors={["Transport", "Logistics"]}
                    initialServiceSectorFilter="Transport"
                    triggerLabel="Add Transport"
                    dialogTitle="New Transport Listing"
                    dialogDescription="Create only transport listings here. Final fare and trip flow will be managed from the same transport tab."
                  />
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-sky-200 bg-white p-3">
                    <p className="text-[10px] uppercase tracking-widest text-sky-700 font-semibold">Live Transport Listings</p>
                    <p className="font-display font-black text-2xl text-emerald-950 mt-1">{transportItems.length}</p>
                    <p className="text-xs text-slate-600 mt-1">Customer ride/service chooser-এ দেখানোর জন্য live transport cards.</p>
                  </div>
                  <div className="rounded-lg border border-sky-200 bg-white p-3">
                    <p className="text-[10px] uppercase tracking-widest text-sky-700 font-semibold">Trip Queue</p>
                    <p className="font-display font-black text-2xl text-emerald-950 mt-1">{transportData?.items?.length || 0}</p>
                    <p className="text-xs text-slate-600 mt-1">Booked, confirmed, on-trip, completed, paid সব booking state এখানে track হবে.</p>
                  </div>
                </div>
                {transportItems.length === 0 ? (
                  <div className="mt-4 rounded-lg border border-dashed border-sky-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                    No transport listing yet. Use Add Transport to create cab, rental, or cargo service.
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                    {transportItems.map((p) => (
                      <div key={p.id} className="rounded-lg border border-border overflow-hidden bg-white">
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
                        <div className="p-3">
                          <p className="text-[10px] uppercase tracking-widest text-sky-700 font-semibold">Transport</p>
                          <p className="font-semibold text-sm text-emerald-950 mt-0.5">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.category}</p>
                          <p className="font-display font-black text-emerald-800 mt-1">{withUnit(p.price, p.unit_type)}</p>
                          <p className="text-[10px] text-slate-500">{String(p?.service_template_key || "transport").replace(/_/g, " ")}</p>
                          <div className="flex gap-1 mt-2">
                            <PartnerProductForm
                              product={p}
                              onSaved={loadAll}
                              fixedListingType="service"
                              allowedServiceSectors={["Transport", "Logistics"]}
                              initialServiceSectorFilter="Transport"
                              triggerLabel="Edit Transport"
                              dialogTitle="Edit Transport Listing"
                              dialogDescription="Update only this transport listing. Fare confirmation and trip execution stay in the transport tab."
                            />
                            <Button size="sm" variant="outline" className="rounded-full border-red-300 text-red-700 hover:bg-red-50 h-7 px-2 text-[11px]" onClick={() => deleteProduct(p.id)} data-testid={`del-my-transport-${p.id}`}>Delete</Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-[10px] uppercase tracking-widest text-amber-800 font-semibold">How Transport Approval Works</p>
                <div className="mt-3 space-y-3 text-xs text-amber-900">
                  <div className="rounded-lg border border-amber-200 bg-white px-3 py-2">
                    <p className="font-semibold">1. While status = booked, final fare set করুন</p>
                    <p className="mt-1">এই stage-এ fare change করা যাবে। trip start/confirm হওয়ার পর আর fare edit হবে না।</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-white px-3 py-2">
                    <p className="font-semibold">2. Confirm Booking দিলে fare lock হবে</p>
                    <p className="mt-1">Backend অনুযায়ী reserve wallet থেকে required commission debit হয়, METHO-তে credit হয়, order auto-approved হয়, তারপর trip status confirmed হয়।</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-white px-3 py-2">
                    <p className="font-semibold">3. Confirm হওয়ার পর Start Trip button আসবে</p>
                    <p className="mt-1">মানে auto-approval হয়, কিন্তু trip auto-start হয় না। Partner manually Start Trip চাপবে।</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-white px-3 py-2">
                    <p className="font-semibold">4. Complete Trip -> Show QR -> Mark Paid</p>
                    <p className="mt-1">Destination-এ customer payment নিলে transaction ID দিয়ে paid mark করবেন।</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4" data-testid="transport-fare-presets-block">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Common Destination Fare Presets</p>
              <p className="text-xs text-slate-600 mt-1">Partner আগে থেকে destination + fare set করে রাখলে customer booking-এ tick/select করে direct book করতে পারবে।</p>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                <select
                  value={presetForm.service_product_id}
                  onChange={(e) => setPresetForm((prev) => ({ ...prev, service_product_id: e.target.value }))}
                  className="h-10 rounded-md border border-input bg-white px-3 text-sm"
                >
                  <option value="">Select transport service</option>
                  {transportServices.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.category})</option>
                  ))}
                </select>
                <Input
                  value={presetForm.destination}
                  onChange={(e) => setPresetForm((prev) => ({ ...prev, destination: e.target.value }))}
                  placeholder="Common destination (e.g. Airport Terminal 2)"
                  className="h-10"
                />
                <Input
                  type="number"
                  min="1"
                  step="0.01"
                  value={presetForm.fare}
                  onChange={(e) => setPresetForm((prev) => ({ ...prev, fare: e.target.value }))}
                  placeholder="Preset fare"
                  className="h-10"
                />
                <Input
                  value={presetForm.pickup_hint}
                  onChange={(e) => setPresetForm((prev) => ({ ...prev, pickup_hint: e.target.value }))}
                  placeholder="Pickup hint (optional)"
                  className="h-10"
                />
              </div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                <Input
                  value={presetForm.notes}
                  onChange={(e) => setPresetForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Notes (optional)"
                  className="h-10"
                />
                <Button className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" onClick={saveFarePreset} disabled={presetBusy}>
                  {presetBusy ? "Saving..." : "Save Preset"}
                </Button>
              </div>

              {(transportPresets || []).length ? (
                <div className="mt-3 space-y-2">
                  {transportPresets.map((preset) => (
                    <div key={preset.id} className="rounded-lg border border-emerald-200 bg-white px-3 py-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-emerald-950">{preset.destination} · {inr(preset.fare || 0)}</p>
                        <p className="text-xs text-slate-600">Service ID: {preset.service_product_id || "all transport services"}{preset.pickup_hint ? ` · Pickup: ${preset.pickup_hint}` : ""}</p>
                      </div>
                      <Button size="sm" variant="outline" className="rounded-full border-red-300 text-red-700 hover:bg-red-50" onClick={() => deleteFarePreset(preset.id)}>
                        Delete
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 mt-3">No preset saved yet.</p>
              )}
            </div>

            {loadingTransport ? (
              <p className="text-sm text-slate-500 mt-4">Loading transport bookings...</p>
            ) : (transportData?.items || []).length === 0 ? (
              <p className="text-sm text-muted-foreground mt-4">No transport bookings yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {(transportData?.items || []).map((trip) => {
                  const required = Number(trip?.required_commission_reserve || 0);
                  const fare = Number(trip?.fare_final || trip?.fare_quote || 0);
                  const status = String(trip?.status || "booked");
                  return (
                    <div key={trip.id} className="rounded-xl border border-border p-4" data-testid={`partner-trip-${trip.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-xs text-emerald-800">{trip.trip_code || trip.id}</p>
                          <p className="font-semibold text-emerald-950 mt-1">{trip.service_name || "Transport Service"} · {trip.vehicle_type || "cab"}</p>
                          <p className="text-xs text-slate-600 mt-1">{trip.pickup} -> {trip.destination}</p>
                          <p className="text-xs text-slate-600">Customer: {trip.customer_name || "Customer"}{trip.customer_phone ? ` (${trip.customer_phone})` : ""}</p>
                          <button
                            type="button"
                            className="text-xs text-emerald-800 underline mt-1"
                            onClick={() => {
                              const url = routeMapsUrl(trip.pickup, trip.destination);
                              if (url) window.open(url, "_blank", "noopener,noreferrer");
                            }}
                          >
                            Open route in Google Maps
                          </button>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Status</p>
                          <p className="font-semibold text-emerald-900 uppercase">{status}</p>
                          <p className="text-xs text-slate-600 mt-1">Fare: {inr(fare)}</p>
                          <p className="text-xs text-amber-700">Reserve needed: {inr(required)}</p>
                        </div>
                      </div>

                      {status === "booked" ? (
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
                          <Input
                            type="number"
                            min="1"
                            step="0.01"
                            value={fareDrafts?.[trip.id] ?? fare}
                            onChange={(e) => setFareDrafts((prev) => ({ ...prev, [trip.id]: e.target.value }))}
                            className="h-10"
                            data-testid={`partner-trip-fare-${trip.id}`}
                          />
                          <Button variant="outline" className="rounded-full" onClick={() => updateTripFare(trip.id)}>
                            Save Final Fare
                          </Button>
                          <Button className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" onClick={() => confirmTripBooking(trip.id)}>
                            <CheckCircle2 className="w-4 h-4 mr-1" /> Confirm + Lock Fare + Auto Approve
                          </Button>
                        </div>
                      ) : null}

                      {status === "confirmed" ? (
                        <div className="mt-3">
                          <Button className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" onClick={() => startTrip(trip.id)}>
                            <PlayCircle className="w-4 h-4 mr-1" /> Start Trip
                          </Button>
                        </div>
                      ) : null}

                      {status === "on_trip" ? (
                        <div className="mt-3">
                          <Button className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" onClick={() => completeTrip(trip.id)}>
                            <CheckCircle2 className="w-4 h-4 mr-1" /> Complete Trip (Show QR)
                          </Button>
                        </div>
                      ) : null}

                      {status === "completed" || status === "paid" ? (
                        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                          <p className="text-xs text-emerald-900">Destination reached. Driver QR থেকে payment নিন, তারপর Transaction ID দিন।</p>
                          <div className="flex flex-wrap gap-3 items-start">
                            {paymentProfile?.partner_qr_url ? (
                              <img src={paymentProfile.partner_qr_url} alt="Partner payment QR" className="w-24 h-24 rounded-lg border border-border bg-white object-contain" />
                            ) : null}
                            <div className="text-xs text-slate-700">
                              <p className="font-semibold text-emerald-900">Payment UPI</p>
                              <p className="font-mono">{paymentProfile?.partner_upi_id || "Not set"}</p>
                              {!paymentProfile?.partner_qr_url ? <p className="text-amber-700 mt-1">QR আপলোড না থাকলে আগে Overview tab থেকে partner payment QR upload করুন।</p> : null}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Input
                              value={txnDrafts?.[trip.id] || ""}
                              onChange={(e) => setTxnDrafts((prev) => ({ ...prev, [trip.id]: e.target.value }))}
                              placeholder="UPI Transaction ID"
                              className="h-10"
                            />
                            <Button className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" onClick={() => markTripPaid(trip.id)}>
                              Mark Paid
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
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


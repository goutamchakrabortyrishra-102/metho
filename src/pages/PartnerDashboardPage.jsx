import React, { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Store, TrendingUp, Percent, Package, ShoppingCart, FileText, LogOut, ScrollText, FileSpreadsheet, FileDown, Images, ReceiptText, Copy, MessageCircle, ExternalLink, CarTaxiFront, PlayCircle, CheckCircle2, Wallet, Clock3, XCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import PartnerProductForm from "@/components/PartnerProductForm";
import OfflineBillingPanel from "@/components/OfflineBillingPanel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resolveAssetUrl } from "@/lib/utils";
import { inferPartnerPrimarySector, getPartnerVisibleSectors, isDoorstepServiceLike, isHospitalityServiceLike, isTransportServiceLike, PARTNER_SECTOR_KEYS } from "@/lib/partnerSector";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const withUnit = (price, unitType) => {
  const unit = String(unitType || "piece").trim().toLowerCase() || "piece";
  return unit === "piece" ? inr(price) : `${inr(price)} / ${unit}`;
};
const paymentModeLabel = (mode) => {
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized === "cod" || normalized === "cash") return "COD";
  if (normalized === "upi" || normalized === "manual_upi") return "UPI";
  if (normalized === "razorpay" || normalized === "online") return "ONLINE";
  if (!normalized) return "NOT SET";
  return normalized.toUpperCase();
};
const routeMapsUrl = (pickup, destination) => {
  const origin = String(pickup || "").trim();
  const dest = String(destination || "").trim();
  if (!origin && !dest) return "";
  if (!dest) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(origin)}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=driving`;
};
const isTransportServiceListing = (item) => {
  return isTransportServiceLike(item);
};
const HOSPITALITY_SERVICE_SECTORS = ["Hotel", "Homestay", "Restaurant", "Cafe"];
const RESTAURANT_SLOT_TEMPLATE_KEYS = new Set([
  "restaurant_table_booking",
  "banquet_slot",
  "restaurant_takeaway_slot",
  "cafe_table_reservation",
]);
const DOORSTEP_OTHER_SLOT_TEMPLATE_KEYS = new Set([
  "ac_service_visit",
  "plumbing_repair",
  "electrician_visit",
  "appliance_repair",
  "laundry_kg_service",
  "dry_clean_service",
  "tailoring_stitching",
  "beauty_home_service",
  "courier_pickup",
  "house_deep_clean",
  "office_cleaning",
  "pest_control_visit",
  "doctor_consultation",
  "diagnostic_visit",
  "tele_consultation",
  "dental_checkup",
  "pathology_test_slot",
  "ultrasound_slot",
  "yoga_class_slot",
  "tuition_monthly_batch",
  "coaching_mock_test",
  "salon_haircut",
  "salon_grooming_package",
  "salon_bridal_package",
  "spa_session",
  "gym_personal_training",
  "photo_event_shoot",
  "video_shoot_edit",
]);
const DOORSTEP_SERVICE_SECTORS = ["Home Service", "Laundry", "Beauty at Home", "Cleaning", "Courier", "Tailoring"];
const isHospitalityServiceListing = (item) => {
  return isHospitalityServiceLike(item);
};
const isDoorstepServiceListing = (item) => {
  return isDoorstepServiceLike(item);
};
const isRestaurantSlotService = (item) => {
  const key = String(item?.service_template_key || "").trim().toLowerCase();
  return RESTAURANT_SLOT_TEMPLATE_KEYS.has(key);
};
const isDoorstepOrOtherSlotService = (item) => {
  const key = String(item?.service_template_key || "").trim().toLowerCase();
  return DOORSTEP_OTHER_SLOT_TEMPLATE_KEYS.has(key);
};
const serviceRateLabel = (item) => {
  const key = String(item?.service_template_key || "").trim().toLowerCase();
  if (key === "ac_service_visit") return "AC Rate";
  if (key.includes("monthly")) return "Monthly Rate";
  return "Service Rate";
};
const TRANSPORT_STATUS_META = {
  booked: { label: "New Request", tone: "bg-sky-100 text-sky-800 border-sky-200" },
  confirmed: { label: "Confirmed", tone: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  on_trip: { label: "On Trip", tone: "bg-violet-100 text-violet-800 border-violet-200" },
  completed: { label: "Completed", tone: "bg-amber-100 text-amber-800 border-amber-200" },
  paid: { label: "Paid", tone: "bg-teal-100 text-teal-800 border-teal-200" },
  rejected: { label: "Rejected", tone: "bg-rose-100 text-rose-800 border-rose-200" },
};
const PARTNER_IMAGE_MAX_BYTES = 200 * 1024;
const PARTNER_IMAGE_MAX_TEXT = "200KB";
const PDF_PREVIEW = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%25' stop-color='%23eff6ff'/><stop offset='100%25' stop-color='%23ecfdf5'/></linearGradient></defs><rect width='400' height='400' rx='28' fill='url(%23g)'/><rect x='62' y='54' width='276' height='292' rx='26' fill='%23ffffff' stroke='%23cbd5e1' stroke-width='4'/><circle cx='142' cy='142' r='22' fill='%23f59e0b' opacity='0.95'/><path d='M95 292 L162 220 L213 262 L260 208 L305 292 Z' fill='%2394a3b8' opacity='0.35'/><path d='M95 292 H305' stroke='%2394a3b8' stroke-width='5' stroke-linecap='round'/><text x='200' y='330' text-anchor='middle' fill='%230f766e' font-size='20' font-family='Arial' font-weight='700'>Image Preview</text></svg>";

const getPreviewImageUrl = (product) => {
  const imageUrl = resolveAssetUrl(product?.image_url || "");
  if (imageUrl) return imageUrl;
  return getPdfUrl(product) ? PDF_PREVIEW : "";
};

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

const getPartnerProductImageUrl = (product) => {
  return firstValidAssetRef(
    product?.image_url,
    product?.product_image_url,
    product?.image,
    product?.thumbnail_url,
    product?.thumb_url,
    product?.photo_url,
    ""
  );
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

const Tab = ({ id, active, onClick, children, activeClassName, idleClassName }) => (
  <button
    onClick={() => onClick(id)}
    className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${active === id ? activeClassName : idleClassName}`}
    data-testid={`tab-${id}`}
  >
    {children}
  </button>
);

const DASHBOARD_SECTOR_LABEL = {
  [PARTNER_SECTOR_KEYS.PRODUCT_SECTOR]: "Products",
  [PARTNER_SECTOR_KEYS.TRANSPORT_SECTOR]: "Transport",
  [PARTNER_SECTOR_KEYS.HOSPITALITY_SECTOR]: "Stay & Dining",
  [PARTNER_SECTOR_KEYS.DOORSTEP_SECTOR]: "Doorstep",
  [PARTNER_SECTOR_KEYS.OTHER_SERVICE_SECTOR]: "Other Services",
};

const getDashboardTheme = (primarySector) => {
  if (primarySector === PARTNER_SECTOR_KEYS.TRANSPORT_SECTOR) {
    return {
      headerClass: "bg-sky-950 text-white",
      chipClass: "text-sky-300",
      metricHighlightClass: "bg-gradient-to-br from-sky-100 to-cyan-100 border-sky-300",
      tabActiveClass: "bg-sky-900 text-white border-sky-900",
      tabIdleClass: "bg-white text-sky-900 border-sky-200 hover:bg-sky-50",
      overviewHeroClass: "border-sky-300 bg-sky-50",
      overviewTitle: "Transport Control Center",
      overviewDesc: "Trip request, fare locking, and transport listing management একসাথে এখানে করুন।",
    };
  }
  if (primarySector === PARTNER_SECTOR_KEYS.HOSPITALITY_SECTOR) {
    return {
      headerClass: "bg-amber-950 text-white",
      chipClass: "text-amber-300",
      metricHighlightClass: "bg-gradient-to-br from-amber-100 to-orange-100 border-amber-300",
      tabActiveClass: "bg-amber-800 text-white border-amber-800",
      tabIdleClass: "bg-white text-amber-900 border-amber-200 hover:bg-amber-50",
      overviewHeroClass: "border-amber-300 bg-amber-50",
      overviewTitle: "Hotel & Homestay Operations Desk",
      overviewDesc: "Stay/dining listing, room/service showcase, and hospitality operations এখানে আলাদাভাবে পরিচালনা করুন।",
    };
  }
  return {
    headerClass: "bg-emerald-950 text-white",
    chipClass: "text-amber-400",
    metricHighlightClass: "bg-gradient-to-br from-amber-100 to-emerald-100 border-amber-300",
    tabActiveClass: "bg-emerald-900 text-white border-emerald-900",
    tabIdleClass: "bg-white text-emerald-900 border-emerald-200 hover:bg-emerald-50",
    overviewHeroClass: "border-amber-300 bg-amber-50",
    overviewTitle: "Listing Manager",
    overviewDesc: "Registration sector অনুযায়ী আপনার dashboard-এ নির্দিষ্ট listing tab দেখানো হচ্ছে।",
  };
};

export default function PartnerDashboardPage() {
  const location = useLocation();
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
  const [savedFeaturedImages, setSavedFeaturedImages] = useState(["", "", "", "", ""]);
  const [uploadingFeatured, setUploadingFeatured] = useState({});
  const [savingFeaturedImages, setSavingFeaturedImages] = useState(false);
  const [sendingTopup, setSendingTopup] = useState(false);
  const [sendingRazorpay, setSendingRazorpay] = useState(false);
  const [shopBannerUrl, setShopBannerUrl] = useState("");
  const [partnerUpiId, setPartnerUpiId] = useState("");
  const [partnerBusinessYoutubeUrl, setPartnerBusinessYoutubeUrl] = useState("");
  const [partnerBusinessFacebookUrl, setPartnerBusinessFacebookUrl] = useState("");
  const [partnerCodEnabled, setPartnerCodEnabled] = useState(true);
  const [offerPopupEnabled, setOfferPopupEnabled] = useState(false);
  const [offerPopupTitle, setOfferPopupTitle] = useState("");
  const [offerPopupMessage, setOfferPopupMessage] = useState("");
  const [offerPopupCtaText, setOfferPopupCtaText] = useState("");
  const [offerPopupCoupon, setOfferPopupCoupon] = useState("");
  const [savingPartnerUpi, setSavingPartnerUpi] = useState(false);
  const [sendingInvoiceOrderId, setSendingInvoiceOrderId] = useState("");
  const [transportData, setTransportData] = useState({ items: [], wallet: { balance: 0 } });
  const [loadingTransport, setLoadingTransport] = useState(false);
  const [fareDrafts, setFareDrafts] = useState({});
  const [txnDrafts, setTxnDrafts] = useState({});
  const [transportStatusFilter, setTransportStatusFilter] = useState("all");
  const [rejectReasonDrafts, setRejectReasonDrafts] = useState({});
  const [serviceFareDrafts, setServiceFareDrafts] = useState({});
  const [serviceActionBusy, setServiceActionBusy] = useState({});
  const [restaurantRateDrafts, setRestaurantRateDrafts] = useState({});
  const [restaurantCapacityDrafts, setRestaurantCapacityDrafts] = useState({});
  const [restaurantConfigBusy, setRestaurantConfigBusy] = useState({});
  const [serviceSlotRateDrafts, setServiceSlotRateDrafts] = useState({});
  const [serviceSlotConfigBusy, setServiceSlotConfigBusy] = useState({});
  const [ordersShortcutPinned, setOrdersShortcutPinned] = useState(false);
  const normalizedProducts = Array.isArray(products) ? products : [];
  const normalizedLedger = Array.isArray(ledger) ? ledger : [];
  const normalizedOrders = Array.isArray(orders) ? orders : [];
  const productItems = normalizedProducts.filter((p) => !(String(p?.listing_type || p?.item_kind || "").toLowerCase().includes("service") || p?.is_service));
  const transportItems = normalizedProducts.filter((p) => (String(p?.listing_type || p?.item_kind || "").toLowerCase().includes("service") || p?.is_service) && isTransportServiceListing(p));
  const hospitalityItems = normalizedProducts.filter((p) => (String(p?.listing_type || p?.item_kind || "").toLowerCase().includes("service") || p?.is_service) && !isTransportServiceListing(p) && isHospitalityServiceListing(p));
  const doorstepItems = normalizedProducts.filter((p) => (String(p?.listing_type || p?.item_kind || "").toLowerCase().includes("service") || p?.is_service) && !isTransportServiceListing(p) && !isHospitalityServiceListing(p) && isDoorstepServiceListing(p));
  const serviceItems = normalizedProducts.filter((p) => (String(p?.listing_type || p?.item_kind || "").toLowerCase().includes("service") || p?.is_service) && !isTransportServiceListing(p) && !isHospitalityServiceListing(p) && !isDoorstepServiceListing(p));
  const featuredProductFallbacks = productItems
    .map((item) => getPartnerProductImageUrl(item))
    .filter(Boolean)
    .slice(0, 5);
  const featuredDashboardImages = [0, 1, 2, 3, 4].map((slot) => featuredImages[slot] || featuredProductFallbacks[slot] || "");
  const featuredDraftSnapshot = JSON.stringify(normalizeFeaturedImages({ items: featuredImages }));
  const featuredSavedSnapshot = JSON.stringify(normalizeFeaturedImages({ items: savedFeaturedImages }));
  const hasUnsavedFeaturedChanges = featuredDraftSnapshot !== featuredSavedSnapshot;
  const primarySector = inferPartnerPrimarySector({
    businessType: summary?.business_type,
    businessName: summary?.business_name,
    counts: {
      products: productItems.length,
      transport: transportItems.length,
      hospitality: hospitalityItems.length,
      doorstep: doorstepItems.length,
      otherServices: serviceItems.length,
    },
  });
  const visibleSectors = getPartnerVisibleSectors(primarySector);
  const canViewProductsSector = visibleSectors.includes(PARTNER_SECTOR_KEYS.PRODUCT_SECTOR);
  const canViewTransportSector = visibleSectors.includes(PARTNER_SECTOR_KEYS.TRANSPORT_SECTOR);
  const canViewHospitalitySector = visibleSectors.includes(PARTNER_SECTOR_KEYS.HOSPITALITY_SECTOR);
  const canViewDoorstepSector = visibleSectors.includes(PARTNER_SECTOR_KEYS.DOORSTEP_SECTOR);
  const canViewOtherServiceSector = visibleSectors.includes(PARTNER_SECTOR_KEYS.OTHER_SERVICE_SECTOR);
  const sectorTabs = [
    canViewProductsSector ? "products" : null,
    canViewTransportSector ? "transport" : null,
    canViewHospitalitySector ? "stay-dining" : null,
    canViewDoorstepSector ? "doorstep" : null,
    canViewOtherServiceSector ? "services" : null,
  ].filter(Boolean);
  const listingDefaultTab = sectorTabs[0] || "products";
  const dashboardTheme = getDashboardTheme(primarySector);
  const summaryThisMonth = (summary && typeof summary === "object" && summary.this_month && typeof summary.this_month === "object")
    ? summary.this_month
    : { sales: 0, commission: 0, orders: 0 };
  const sortedTransportTrips = [...(transportData?.items || [])].sort((a, b) => {
    const aTs = new Date(a?.created_at || 0).getTime();
    const bTs = new Date(b?.created_at || 0).getTime();
    return bTs - aTs;
  });
  const transportStatusCounts = sortedTransportTrips.reduce((acc, trip) => {
    const key = String(trip?.status || "booked");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const visibleTransportTrips = transportStatusFilter === "all"
    ? sortedTransportTrips
    : sortedTransportTrips.filter((trip) => String(trip?.status || "booked") === transportStatusFilter);

  const loadAll = () => {
    api.get("/partner/summary").then((r) => {
      const next = r?.data;
      setSummary(next && typeof next === "object" ? next : null);
    }).catch(() => {});
    api.get("/partner/products").then((r) => {
      const next = r?.data;
      setProducts(Array.isArray(next) ? next : (Array.isArray(next?.items) ? next.items : []));
    }).catch(() => setProducts([]));
    api.get("/partner/ledger").then((r) => {
      const next = r?.data;
      setLedger(Array.isArray(next) ? next : (Array.isArray(next?.items) ? next.items : []));
    }).catch(() => setLedger([]));
    api.get("/partner/orders").then((r) => {
      const next = r?.data;
      setOrders(Array.isArray(next) ? next : (Array.isArray(next?.items) ? next.items : []));
    }).catch(() => setOrders([]));
    api.get("/settings").then(r => setSettings(r.data)).catch(() => setSettings(null));
    api.get("/partner/payment-profile").then(r => setPaymentProfile(r.data)).catch(() => {});
    api.get("/partner/banner").then(r => setShopBannerUrl(resolveAssetUrl(r.data?.banner_url || ""))).catch(() => setShopBannerUrl(""));
    api.get("/partner/featured-images").then(r => {
      const normalized = normalizeFeaturedImages(r.data);
      setFeaturedImages(normalized);
      setSavedFeaturedImages(normalized);
    }).catch(() => {
      // Keep current UI state if reload fails; avoid wiping freshly uploaded previews.
    });
    setLoadingTransport(true);
    api.get("/partner/transport/bookings").then((r) => {
      const next = r?.data && typeof r.data === "object" ? r.data : {};
      setTransportData({
        ...next,
        wallet: (next.wallet && typeof next.wallet === "object") ? next.wallet : { balance: 0 },
        items: Array.isArray(next.items) ? next.items : [],
      });
    }).catch(() => setTransportData({ items: [], wallet: { balance: 0 } })).finally(() => setLoadingTransport(false));
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

  const saveRestaurantSlotConfig = async (productId, fallbackPrice, fallbackStock) => {
    const rate = Number(restaurantRateDrafts?.[productId] ?? fallbackPrice ?? 0);
    const capacity = Number(restaurantCapacityDrafts?.[productId] ?? fallbackStock ?? 0);
    if (rate <= 0) {
      toast.error("Booking rate valid দিন");
      return;
    }
    if (!Number.isFinite(capacity) || capacity < 0) {
      toast.error("Seating capacity valid দিন");
      return;
    }

    setRestaurantConfigBusy((prev) => ({ ...prev, [productId]: true }));
    try {
      await api.put(`/partner/products/${productId}`, {
        price: rate,
        stock: Math.floor(capacity),
      });
      toast.success("Restaurant slot rate/capacity updated");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Update failed");
    } finally {
      setRestaurantConfigBusy((prev) => ({ ...prev, [productId]: false }));
    }
  };

  const saveServiceSlotRate = async (productId, fallbackPrice) => {
    const rate = Number(serviceSlotRateDrafts?.[productId] ?? fallbackPrice ?? 0);
    if (rate <= 0) {
      toast.error("Valid rate দিন");
      return;
    }
    setServiceSlotConfigBusy((prev) => ({ ...prev, [productId]: true }));
    try {
      await api.put(`/partner/products/${productId}`, { price: rate });
      toast.success("Service rate updated");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Update failed");
    } finally {
      setServiceSlotConfigBusy((prev) => ({ ...prev, [productId]: false }));
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

  const rejectTripBooking = async (tripId) => {
    const reason = String(rejectReasonDrafts?.[tripId] || "").trim();
    try {
      await api.post(`/partner/transport/bookings/${tripId}/reject`, { reason });
      toast.success("Booking request rejected");
      setRejectReasonDrafts((prev) => ({ ...prev, [tripId]: "" }));
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Reject failed");
    }
  };

  const setServiceBusy = (orderId, patch) => {
    setServiceActionBusy((prev) => ({
      ...prev,
      [orderId]: {
        updating: false,
        confirming: false,
        ...(prev?.[orderId] || {}),
        ...patch,
      },
    }));
  };

  const updateServiceFinalFare = async (orderId) => {
    const amount = Number(serviceFareDrafts?.[orderId] || 0);
    if (!amount || amount <= 0) {
      toast.error("Valid final fare দিন");
      return;
    }
    setServiceBusy(orderId, { updating: true });
    try {
      await api.post(`/partner/orders/${orderId}/service-final-fare`, { final_amount: amount });
      toast.success("Final fare updated. Confirm করলে fare lock হবে");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Final fare update failed");
    } finally {
      setServiceBusy(orderId, { updating: false });
    }
  };

  const confirmServiceBooking = async (orderId) => {
    if (!window.confirm("Confirm booking করলে fare lock হবে এবং commission debit flow চলবে. Continue করবেন?")) return;
    setServiceBusy(orderId, { confirming: true });
    try {
      await api.post(`/partner/orders/${orderId}/service-confirm`, {});
      toast.success("Booking confirmed. Fare locked + auto approval done");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Service booking confirmation failed");
    } finally {
      setServiceBusy(orderId, { confirming: false });
    }
  };

  useEffect(() => {
    if (user?.role !== "partner") return;
    loadAll();
  }, [user]);

  useEffect(() => {
    try {
      setOrdersShortcutPinned(window.localStorage.getItem("metho_partner_orders_shortcut_v1") === "1");
    } catch {}
  }, []);

  useEffect(() => {
    const requestedTab = String(new URLSearchParams(location.search).get("tab") || "").trim().toLowerCase();
    if (!requestedTab) return;
    const allowedTabs = new Set(["overview", "offline", "orders", "ledger", ...sectorTabs]);
    if (allowedTabs.has(requestedTab) && requestedTab !== tab) {
      setTab(requestedTab);
    }
  }, [location.search, sectorTabs, tab]);

  useEffect(() => {
    const allowedTabs = new Set(["overview", "offline", "orders", "ledger", ...sectorTabs]);
    if (!allowedTabs.has(tab)) {
      setTab(tab === "overview" ? listingDefaultTab : "overview");
    }
  }, [tab, listingDefaultTab, sectorTabs]);

  useEffect(() => {
    if (!paymentProfile) return;
    setPartnerUpiId(paymentProfile?.partner_upi_id || "");
    setPartnerBusinessYoutubeUrl(String(paymentProfile?.business_youtube_url || ""));
    setPartnerBusinessFacebookUrl(String(paymentProfile?.business_facebook_url || ""));
    setPartnerCodEnabled(paymentProfile?.cod_enabled !== false);
    setOfferPopupEnabled(paymentProfile?.offer_popup?.enabled === true);
    setOfferPopupTitle(String(paymentProfile?.offer_popup?.title || ""));
    setOfferPopupMessage(String(paymentProfile?.offer_popup?.message || ""));
    setOfferPopupCtaText(String(paymentProfile?.offer_popup?.cta_text || ""));
    setOfferPopupCoupon(String(paymentProfile?.offer_popup?.coupon_code || ""));
  }, [paymentProfile]);

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

  const sendInvoicePdfOnWhatsApp = async (order) => {
    if (!order?.id) return;
    if (sendingInvoiceOrderId === order.id) return;
    setSendingInvoiceOrderId(order.id);
    try {
      const response = await api.get(`/orders/${order.id}/invoice/pdf`, { responseType: "blob" });
      const pdfBlob = response?.data instanceof Blob
        ? response.data
        : new Blob([response?.data], { type: "application/pdf" });
      const fallbackName = `Invoice_${String(order?.order_no || order.id || "order").replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;

      const anchor = document.createElement("a");
      const objectUrl = URL.createObjectURL(pdfBlob);
      anchor.href = objectUrl;
      anchor.download = fallbackName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

      const backendUrl = String(order?.customer_whatsapp_invoice_url || "").trim();
      const phoneFromOrder = String(order?.delivery_phone || "").replace(/\D/g, "");
      const phoneFromBackendUrl = (backendUrl.match(/wa\.me\/(\d{6,15})/) || backendUrl.match(/[?&]phone=(\d{6,15})/))?.[1] || "";
      const phoneDigits = phoneFromOrder || phoneFromBackendUrl;

      const invoiceLink = `${window.location.origin}/invoice/${order.id}`;
      const message = `Invoice ready for ${order?.order_no || "your order"}\nCustomer: ${order?.delivery_name || "Customer"}\nOpen invoice: ${invoiceLink}\nPDF downloaded. Please attach and send.`;

      let whatsappUrl = "";
      if (phoneDigits) {
        whatsappUrl = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
      } else if (backendUrl) {
        whatsappUrl = backendUrl;
      }

      if (whatsappUrl) {
        window.open(whatsappUrl, "_blank", "noopener,noreferrer");
        toast.success("PDF downloaded and customer WhatsApp chat opened.");
      } else {
        toast.success("PDF downloaded. Customer WhatsApp number not found, attach and send manually.");
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === "string" && detail.trim()
        ? detail
        : "Invoice PDF send failed";
      toast.error(msg);
    } finally {
      setSendingInvoiceOrderId("");
    }
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
      ...normalizedLedger.map(e => [new Date(e.created_at).toLocaleString(), e.period, e.sales_amount, e.commission_percent, e.commission_amount]),
      [], ["TOTAL", "", normalizedLedger.reduce((s, e) => s + (e.sales_amount || 0), 0), "", normalizedLedger.reduce((s, e) => s + (e.commission_amount || 0), 0)],
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

  const saveOrdersShortcut = () => {
    try {
      window.localStorage.setItem("metho_partner_orders_shortcut_v1", "1");
    } catch {}
    setOrdersShortcutPinned(true);
    toast.success("New Orders shortcut saved for mobile screen");
  };

  const deleteProduct = async (id) => {
    if (!window.confirm("Delete this product?")) return;
    try {
      await api.delete(`/partner/products/${id}`);
      loadAll();
    } catch {}
  };

  const deleteTransportImage = async (item) => {
    if (!item?.id) return;
    if (!window.confirm("Delete uploaded image for this transport listing?")) return;
    try {
      const listingType = String(item?.listing_type || item?.item_kind || "service").toLowerCase().includes("service")
        ? "service"
        : "product";
      const isService = listingType === "service" || Boolean(item?.is_service);
      const payload = {
        ...item,
        name: String(item?.name || "").trim(),
        category: String(item?.category || "").trim(),
        description: String(item?.description || ""),
        price: Number(item?.price || 0),
        stock: Number(item?.stock || (isService ? 1 : 0)),
        discount_percent: Number(item?.discount_percent || 0),
        gst_percent: Number(item?.gst_percent || 0),
        image_url: "",
        pdf_url: "",
        listing_type: isService ? "service" : "product",
        item_kind: isService ? "service" : "product",
        is_service: isService,
        service_booking_enabled: isService,
        service_invoice_mode: isService ? String(item?.service_invoice_mode || "detailed").toLowerCase() : "detailed",
        service_template_key: isService ? String(item?.service_template_key || "").trim() : "",
        unit_type: isService ? "piece" : String(item?.unit_type || "piece").toLowerCase(),
      };
      await api.put(`/partner/products/${item.id}`, payload);
      toast.success("Transport image deleted");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Image delete failed");
    }
  };

  const uploadTopupProof = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
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

  const savePartnerUpiId = async ({ validateOffer = false } = {}) => {
    if (validateOffer && offerPopupEnabled && !String(offerPopupTitle || offerPopupMessage || "").trim()) {
      toast.error("Popup enabled থাকলে title বা message দিতে হবে");
      return;
    }
    setSavingPartnerUpi(true);
    try {
      const { data } = await api.put("/partner/payment-profile", {
        upi_id: String(partnerUpiId || "").trim(),
        business_youtube_url: String(partnerBusinessYoutubeUrl || "").trim(),
        business_facebook_url: String(partnerBusinessFacebookUrl || "").trim(),
        cod_enabled: !!partnerCodEnabled,
        offer_popup: {
          enabled: !!offerPopupEnabled,
          title: String(offerPopupTitle || "").trim(),
          message: String(offerPopupMessage || "").trim(),
          cta_text: String(offerPopupCtaText || "").trim(),
          coupon_code: String(offerPopupCoupon || "").trim(),
        },
      });
      setPaymentProfile((prev) => ({
        ...(prev || {}),
        ...data,
      }));
      toast.success("Payment settings updated");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Payment settings update failed");
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
        setSavedFeaturedImages(normalized);
      } else {
        const directUrl = data?.url || data?.image_url || data?.file_url || data?.path || "";
        setFeaturedImages((prev) => {
          const next = mergeFeaturedBySlot(prev, slot, directUrl);
          setSavedFeaturedImages(next);
          return next;
        });
      }
      toast.success(`Featured image ${slot} uploaded`);
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Featured image upload failed");
    } finally {
      setUploadingFeatured((prev) => ({ ...prev, [slot]: false }));
    }
  };

  const saveFeaturedImages = async () => {
    setSavingFeaturedImages(true);
    try {
      const items = normalizeFeaturedImages({ items: featuredImages });
      // Slot uploads are persisted immediately; this action commits the draft state in UI and refreshes from server.
      setSavedFeaturedImages(items);
      toast.success("Featured images saved");
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Featured images save failed");
    } finally {
      setSavingFeaturedImages(false);
    }
  };

  if (!user) return <div className="p-8 text-center">Loading...</div>;
  if (user.role !== "partner") return <Navigate to="/app" replace />;

  const manualUpiEnabled = !!settings?.manual_upi_enabled;
  const razorpayEnabled = !!settings?.razorpay_enabled && !!settings?.razorpay_key_id;

  return (
    <div className="min-h-screen bg-slate-100" data-testid="partner-dashboard">
      {/* Header */}
      <header className={dashboardTheme.headerClass}>
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-400 text-emerald-950 flex items-center justify-center"><Store className="w-5 h-5" /></div>
            <div>
              <p className={`text-[10px] uppercase tracking-widest font-bold ${dashboardTheme.chipClass}`}>Partner Portal</p>
              <h1 className="font-display font-black text-lg">{summary?.business_name || user.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <p className={`text-[10px] uppercase font-bold ${dashboardTheme.chipClass}`}>Partner Code</p>
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
            <div className={`${dashboardTheme.metricHighlightClass} rounded-xl border p-4`}><div className="flex items-center gap-2 text-amber-800 text-[10px] uppercase font-bold tracking-widest"><ShoppingCart className="w-3.5 h-3.5" /> This Month</div><p className="font-display font-black text-xl text-emerald-950 mt-1">{inr(summaryThisMonth.commission)}</p><p className="text-[10px] text-slate-600">{summaryThisMonth.orders} orders · {inr(summaryThisMonth.sales)} sales</p></div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Tab id="overview" active={tab} onClick={setTab} activeClassName={dashboardTheme.tabActiveClass} idleClassName={dashboardTheme.tabIdleClass}>Overview</Tab>
          {canViewProductsSector ? <Tab id="products" active={tab} onClick={setTab} activeClassName={dashboardTheme.tabActiveClass} idleClassName={dashboardTheme.tabIdleClass}>Products ({productItems.length})</Tab> : null}
          {canViewTransportSector ? <Tab id="transport" active={tab} onClick={setTab} activeClassName={dashboardTheme.tabActiveClass} idleClassName={dashboardTheme.tabIdleClass}>Transport ({transportItems.length})</Tab> : null}
          {canViewHospitalitySector ? <Tab id="stay-dining" active={tab} onClick={setTab} activeClassName={dashboardTheme.tabActiveClass} idleClassName={dashboardTheme.tabIdleClass}>Stay & Dining ({hospitalityItems.length})</Tab> : null}
          {canViewDoorstepSector ? <Tab id="doorstep" active={tab} onClick={setTab} activeClassName={dashboardTheme.tabActiveClass} idleClassName={dashboardTheme.tabIdleClass}>Doorstep ({doorstepItems.length})</Tab> : null}
          {canViewOtherServiceSector ? <Tab id="services" active={tab} onClick={setTab} activeClassName={dashboardTheme.tabActiveClass} idleClassName={dashboardTheme.tabIdleClass}>Other Services ({serviceItems.length})</Tab> : null}
          <Tab id="offline" active={tab} onClick={setTab} activeClassName={dashboardTheme.tabActiveClass} idleClassName={dashboardTheme.tabIdleClass}>Offline Billing</Tab>
          <Tab id="orders" active={tab} onClick={setTab} activeClassName={dashboardTheme.tabActiveClass} idleClassName={dashboardTheme.tabIdleClass}>Orders ({normalizedOrders.length})</Tab>
          <Tab id="ledger" active={tab} onClick={setTab} activeClassName={dashboardTheme.tabActiveClass} idleClassName={dashboardTheme.tabIdleClass}>Ledger ({normalizedLedger.length})</Tab>
        </div>

        {tab === "overview" && summary && (
          <div className="bg-white rounded-xl border border-border p-6">
            <div className={`rounded-xl border p-4 mb-5 ${dashboardTheme.overviewHeroClass}`}>
              <p className="text-[10px] uppercase tracking-widest text-amber-800 font-bold">Listing Manager</p>
              <h3 className="font-display font-bold text-emerald-950 text-base mt-1">{dashboardTheme.overviewTitle}</h3>
              <p className="text-xs text-slate-700 mt-1">{dashboardTheme.overviewDesc} এখন active sector: {DASHBOARD_SECTOR_LABEL[primarySector]}.</p>
              <div className="mt-3">
                <Button
                  type="button"
                  onClick={() => setTab(listingDefaultTab)}
                  className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full"
                  data-testid="go-to-gallery-products-tab"
                >
                  Open {DASHBOARD_SECTOR_LABEL[primarySector] || "Listing"} Manager
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
                <div className="flex items-center gap-2">
                  <p className="text-xs text-slate-500">Max 5 images, 200KB each</p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={saveFeaturedImages}
                    disabled={savingFeaturedImages}
                    className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
                    data-testid="save-featured-images"
                  >
                    {savingFeaturedImages ? "Saving..." : "Save Images"}
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                {[1, 2, 3, 4, 5].map((slot) => {
                  const url = featuredDashboardImages[slot - 1] || "";
                  return (
                    <div key={slot} className="rounded-xl border border-dashed border-slate-300 p-3 bg-slate-50">
                      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Image {slot}</p>
                      <div className="aspect-square rounded-lg overflow-hidden bg-white border border-border flex items-center justify-center">
                        {url ? (
                          <img
                            src={url}
                            alt={`Featured ${slot}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Images className="w-8 h-8 text-slate-300" />
                        )}
                      </div>
                      <label className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 cursor-pointer hover:bg-emerald-50">
                        <input type="file" accept="image/*" onChange={(e) => uploadFeaturedImage(slot, e)} className="hidden" />
                        {uploadingFeatured[slot] ? "Uploading..." : (featuredImages[slot - 1] ? "Replace Image" : (url ? "Use Custom Image" : "Upload Image"))}
                      </label>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] text-slate-500">Custom featured image না দিলে product listing-এর প্রথম 5টা image auto দেখাবে।</p>
              {hasUnsavedFeaturedChanges ? <p className="mt-1 text-[11px] text-amber-700">You have unsaved featured image changes.</p> : null}
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
                      onClick={() => savePartnerUpiId()}
                      disabled={savingPartnerUpi}
                      className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
                    >
                      {savingPartnerUpi ? "Saving..." : "Save Payment Settings"}
                    </Button>
                  </div>
                </div>
                <div className="mt-3">
                  <Label htmlFor="partner-business-youtube">Business YouTube Link</Label>
                  <div className="mt-1.5 flex flex-col sm:flex-row gap-2">
                    <Input
                      id="partner-business-youtube"
                      value={partnerBusinessYoutubeUrl}
                      onChange={(e) => setPartnerBusinessYoutubeUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="h-10"
                    />
                    <Button
                      type="button"
                      onClick={() => savePartnerUpiId()}
                      disabled={savingPartnerUpi}
                      className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
                    >
                      {savingPartnerUpi ? "Saving..." : "Save Link"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">সব product/service-এর জন্য আলাদা link লাগবে না। এই একটি business link public page-এ Watch Video হিসেবে দেখাবে।</p>
                </div>
                <div className="mt-3">
                  <Label htmlFor="partner-business-facebook">Business Facebook Link</Label>
                  <div className="mt-1.5 flex flex-col sm:flex-row gap-2">
                    <Input
                      id="partner-business-facebook"
                      value={partnerBusinessFacebookUrl}
                      onChange={(e) => setPartnerBusinessFacebookUrl(e.target.value)}
                      placeholder="https://www.facebook.com/yourpage"
                      className="h-10"
                    />
                    <Button
                      type="button"
                      onClick={() => savePartnerUpiId()}
                      disabled={savingPartnerUpi}
                      className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
                    >
                      {savingPartnerUpi ? "Saving..." : "Save Link"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">এই single Facebook link public partner page-এ show হবে।</p>
                </div>
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-emerald-900">Cash on Delivery (COD)</p>
                      <p className="text-[11px] text-emerald-800 mt-0.5">Turn COD on or off for your public checkout. Customers will only see COD if this is enabled.</p>
                    </div>
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={partnerCodEnabled}
                        onChange={(e) => setPartnerCodEnabled(!!e.target.checked)}
                        className="h-4 w-4 rounded border-emerald-400"
                      />
                      <span className="text-xs font-semibold text-emerald-900">{partnerCodEnabled ? "Enabled" : "Disabled"}</span>
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-2">After changing this, click Save Payment Settings to apply updates.</p>
                </div>
                <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-blue-900">Shop Popup Offer</p>
                      <p className="text-[11px] text-blue-800 mt-0.5">Create an offer popup that appears on your public shop page.</p>
                    </div>
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={offerPopupEnabled}
                        onChange={(e) => setOfferPopupEnabled(!!e.target.checked)}
                        className="h-4 w-4 rounded border-blue-400"
                      />
                      <span className="text-xs font-semibold text-blue-900">{offerPopupEnabled ? "Enabled" : "Disabled"}</span>
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    <div>
                      <Label htmlFor="offer-popup-title">Offer Title</Label>
                      <Input
                        id="offer-popup-title"
                        value={offerPopupTitle}
                        onChange={(e) => setOfferPopupTitle(e.target.value)}
                        placeholder="e.g. Weekend Special Offer"
                        className="mt-1.5 h-10"
                      />
                    </div>
                    <div>
                      <Label htmlFor="offer-popup-message">Offer Message</Label>
                      <Textarea
                        id="offer-popup-message"
                        value={offerPopupMessage}
                        onChange={(e) => setOfferPopupMessage(e.target.value)}
                        placeholder="Write your offer details for customers..."
                        className="mt-1.5 min-h-[72px]"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor="offer-popup-coupon">Coupon Code (optional)</Label>
                        <Input
                          id="offer-popup-coupon"
                          value={offerPopupCoupon}
                          onChange={(e) => setOfferPopupCoupon(e.target.value)}
                          placeholder="e.g. SAVE20"
                          className="mt-1.5 h-10 font-mono"
                        />
                      </div>
                      <div>
                        <Label htmlFor="offer-popup-cta">Button Text (optional)</Label>
                        <Input
                          id="offer-popup-cta"
                          value={offerPopupCtaText}
                          onChange={(e) => setOfferPopupCtaText(e.target.value)}
                          placeholder="e.g. Shop Now"
                          className="mt-1.5 h-10"
                        />
                      </div>
                    </div>
                    <div className="pt-2 flex justify-end">
                      <Button
                        type="button"
                        onClick={() => savePartnerUpiId({ validateOffer: true })}
                        disabled={savingPartnerUpi}
                        className="rounded-full bg-blue-700 hover:bg-blue-800 text-white"
                      >
                        {savingPartnerUpi ? "Saving..." : "Save Popup Settings"}
                      </Button>
                    </div>
                  </div>
                </div>
                <p className="font-mono text-xs text-emerald-900 mt-2">Current UPI: {paymentProfile?.partner_upi_id || "Not set"}</p>
                <p className="text-xs text-slate-600 mt-1">Current Business Video: {paymentProfile?.business_youtube_url ? "Set" : "Not set"}</p>
                <p className="text-xs text-slate-600 mt-1">Current Business Facebook: {paymentProfile?.business_facebook_url ? "Set" : "Not set"}</p>
                <p className="text-xs text-slate-600 mt-1">Current COD: {paymentProfile?.cod_enabled === false ? "Disabled" : "Enabled"}</p>
                <p className="text-xs text-slate-600 mt-1">Current Offer Popup: {paymentProfile?.offer_popup?.enabled ? "Enabled" : "Disabled"}</p>
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
                <div className="mt-4 flex justify-end">
                  <Button
                    type="button"
                    onClick={() => savePartnerUpiId()}
                    disabled={savingPartnerUpi}
                    className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
                  >
                    {savingPartnerUpi ? "Saving..." : "Save Payment Settings"}
                  </Button>
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

        {tab === "products" && canViewProductsSector && (
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
                      <img src={getPreviewImageUrl(p) || undefined} alt={p.name} className="w-full h-full object-cover" />
                      {getPdfUrl(p) ? (
                        <button
                          type="button"
                          onClick={() => window.open(getPreviewImageUrl(p) || getPdfUrl(p), "_blank")}
                          className="absolute left-2 top-2 rounded-full bg-white/90 text-emerald-900 px-2.5 py-1 text-[10px] font-bold"
                        >
                          Open Preview
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

        {tab === "stay-dining" && canViewHospitalitySector && (
          <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
            <div className="rounded-2xl border border-amber-200/80 bg-white/90 p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-amber-700 font-semibold">Hospitality Desk</p>
                  <h3 className="font-display font-black text-emerald-950 text-xl mt-1">Hotel & Homestay Professional Panel</h3>
                  <p className="text-xs text-slate-600 mt-1">Stay, room, dining, and reservation services এই panel থেকে manage করুন।</p>
                </div>
                <div className="flex items-center gap-2">
                  {summary?.partner_code && (
                    <Link to={`/gallery/${summary.partner_code}?tab=stay-dining`} target="_blank">
                      <Button size="sm" variant="outline" className="rounded-full border-amber-300 text-amber-900 hover:bg-amber-50">
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

              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-amber-700 font-semibold">Live Listings</p>
                  <p className="font-display font-black text-2xl text-emerald-950 mt-1">{hospitalityItems.length}</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-amber-700 font-semibold">Invoice Mode</p>
                  <p className="text-sm font-semibold text-emerald-900 mt-1">Detailed or Summary</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-amber-700 font-semibold">Sector Lock</p>
                  <p className="text-sm font-semibold text-emerald-900 mt-1">Hotel / Homestay / Dining</p>
                </div>
              </div>
            </div>

            <p className="mt-4 mb-4 text-xs text-slate-600">এখান থেকে শুধু hotel, homestay, restaurant, cafe type service add/edit করুন।</p>
            {hospitalityItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-amber-300 bg-white px-4 py-8 text-center text-sm text-slate-500">No stay/dining service yet. Click "Add Stay/Dining" to create one.</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {hospitalityItems.map(p => (
                  <div key={p.id} className="rounded-xl border border-amber-200 overflow-hidden bg-white shadow-sm">
                    <div className="aspect-square bg-secondary relative">
                      <img src={getPreviewImageUrl(p) || undefined} alt={p.name} className="w-full h-full object-cover" />
                      <span className="absolute right-2 top-2 rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[10px] font-bold">Stay/Dining</span>
                      {getPdfUrl(p) ? (
                        <button
                          type="button"
                          onClick={() => window.open(getPreviewImageUrl(p) || getPdfUrl(p), "_blank")}
                          className="absolute left-2 top-2 rounded-full bg-white/90 text-emerald-900 px-2.5 py-1 text-[10px] font-bold"
                        >
                          Open Preview
                        </button>
                      ) : null}
                    </div>
                    <div className="p-3"><p className="font-semibold text-sm text-emerald-950">{p.name}</p><p className="text-xs text-muted-foreground">{p.category}</p><p className="font-display font-black text-emerald-800 mt-1">{withUnit(p.price, p.unit_type)}</p><p className="text-[10px] text-slate-500">{String(p?.service_invoice_mode || "detailed").replace(/_/g, " ")}</p>
                    {isRestaurantSlotService(p) ? (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">Restaurant Slot Control</p>
                        <div>
                          <Label className="text-[10px] text-slate-600">Booking Rate (INR)</Label>
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            value={restaurantRateDrafts?.[p.id] ?? String(Number(p?.price || 0))}
                            onChange={(e) => setRestaurantRateDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            className="h-8 mt-1 text-xs"
                            data-testid={`restaurant-rate-${p.id}`}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-slate-600">Seating Capacity</Label>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={restaurantCapacityDrafts?.[p.id] ?? String(Math.max(0, Number(p?.stock || 0)))}
                            onChange={(e) => setRestaurantCapacityDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            className="h-8 mt-1 text-xs"
                            data-testid={`restaurant-capacity-${p.id}`}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full h-7 px-2 text-[11px] border-amber-300 text-amber-900 hover:bg-amber-100 w-full"
                          disabled={!!restaurantConfigBusy?.[p.id]}
                          onClick={() => saveRestaurantSlotConfig(p.id, p?.price, p?.stock)}
                          data-testid={`restaurant-save-config-${p.id}`}
                        >
                          {restaurantConfigBusy?.[p.id] ? "Saving..." : "Save Slot Config"}
                        </Button>
                      </div>
                    ) : null}
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

        {tab === "doorstep" && canViewDoorstepSector && (
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
                      <img src={getPreviewImageUrl(p) || undefined} alt={p.name} className="w-full h-full object-cover" />
                      {getPdfUrl(p) ? (
                        <button
                          type="button"
                          onClick={() => window.open(getPdfUrl(p), "_blank")}
                          className="absolute left-2 top-2 rounded-full bg-white/90 text-emerald-900 px-2.5 py-1 text-[10px] font-bold"
                        >
                          Open Preview
                        </button>
                      ) : null}
                    </div>
                    <div className="p-3"><p className="font-semibold text-sm text-emerald-950">{p.name}</p><p className="text-xs text-muted-foreground">{p.category}</p><p className="font-display font-black text-emerald-800 mt-1">{withUnit(p.price, p.unit_type)}</p><p className="text-[10px] text-slate-500">{String(p?.service_invoice_mode || "detailed").replace(/_/g, " ")}</p>
                    {isDoorstepOrOtherSlotService(p) ? (
                      <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800">Slot Rate Control</p>
                        <div>
                          <Label className="text-[10px] text-slate-600">{serviceRateLabel(p)} (INR)</Label>
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            value={serviceSlotRateDrafts?.[p.id] ?? String(Number(p?.price || 0))}
                            onChange={(e) => setServiceSlotRateDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            className="h-8 mt-1 text-xs"
                            data-testid={`service-slot-rate-${p.id}`}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full h-7 px-2 text-[11px] border-emerald-300 text-emerald-900 hover:bg-emerald-100 w-full"
                          disabled={!!serviceSlotConfigBusy?.[p.id]}
                          onClick={() => saveServiceSlotRate(p.id, p?.price)}
                          data-testid={`service-slot-save-rate-${p.id}`}
                        >
                          {serviceSlotConfigBusy?.[p.id] ? "Saving..." : "Save Rate"}
                        </Button>
                      </div>
                    ) : null}
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

        {tab === "services" && canViewOtherServiceSector && (
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
                      <img src={getPreviewImageUrl(p) || undefined} alt={p.name} className="w-full h-full object-cover" />
                      {getPdfUrl(p) ? (
                        <button
                          type="button"
                          onClick={() => window.open(getPdfUrl(p), "_blank")}
                          className="absolute left-2 top-2 rounded-full bg-white/90 text-emerald-900 px-2.5 py-1 text-[10px] font-bold"
                        >
                          Open Preview
                        </button>
                      ) : null}
                    </div>
                    <div className="p-3"><p className="font-semibold text-sm text-emerald-950">{p.name}</p><p className="text-xs text-muted-foreground">{p.category}</p><p className="font-display font-black text-emerald-800 mt-1">{withUnit(p.price, p.unit_type)}</p><p className="text-[10px] text-slate-500">{String(p?.service_invoice_mode || "detailed").replace(/_/g, " ")}</p>
                    {isDoorstepOrOtherSlotService(p) ? (
                      <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800">Slot Rate Control</p>
                        <div>
                          <Label className="text-[10px] text-slate-600">{serviceRateLabel(p)} (INR)</Label>
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            value={serviceSlotRateDrafts?.[p.id] ?? String(Number(p?.price || 0))}
                            onChange={(e) => setServiceSlotRateDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            className="h-8 mt-1 text-xs"
                            data-testid={`service-slot-rate-${p.id}`}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full h-7 px-2 text-[11px] border-emerald-300 text-emerald-900 hover:bg-emerald-100 w-full"
                          disabled={!!serviceSlotConfigBusy?.[p.id]}
                          onClick={() => saveServiceSlotRate(p.id, p?.price)}
                          data-testid={`service-slot-save-rate-${p.id}`}
                        >
                          {serviceSlotConfigBusy?.[p.id] ? "Saving..." : "Save Rate"}
                        </Button>
                      </div>
                    ) : null}
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

        {tab === "transport" && canViewTransportSector && (
          <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-6" data-testid="partner-transport-tab">
            <div className="rounded-2xl border border-sky-200/80 bg-white/90 p-4 md:p-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-sky-700 font-semibold">Transport Operations</p>
                <h3 className="font-display font-black text-emerald-950 text-xl mt-1 inline-flex items-center gap-2"><CarTaxiFront className="w-5 h-5" /> Cab / Car Rental / Bike Rental Control Room</h3>
                <p className="text-xs text-slate-600 mt-1">Transport listing, fare lock, reserve check, and trip lifecycle execution - all in one professional panel.</p>
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
                  <div className="rounded-lg border border-sky-200 bg-white p-3 md:col-span-2">
                    <p className="text-[10px] uppercase tracking-widest text-sky-700 font-semibold">Pending Partner Response</p>
                    <p className="font-display font-black text-2xl text-emerald-950 mt-1">{transportStatusCounts?.booked || 0}</p>
                    <p className="text-xs text-slate-600 mt-1">এই request গুলোতে fare set করে accept অথবা reject response দিন।</p>
                  </div>
                </div>
                {transportItems.length === 0 ? (
                  <div className="mt-4 rounded-lg border border-dashed border-sky-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                    No transport listing yet. Use Add Transport to create cab, rental, or cargo service.
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                    {transportItems.map((p) => {
                      const hasPresetImage = String(p?.image_url || "").startsWith("data:image/svg+xml");
                      const noRealImage = !p?.image_url || hasPresetImage;
                      return (
                      <div key={p.id} className={`rounded-lg border overflow-hidden bg-white ${noRealImage ? "border-amber-300" : "border-border"}`}>
                        <div className="aspect-square bg-secondary relative">
                          {noRealImage ? (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-amber-50 gap-2">
                              <span className="text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">No Image</span>
                              <p className="text-[10px] text-amber-800 text-center px-2">Edit করে vehicle image upload করুন</p>
                            </div>
                          ) : (
                            <img src={getPreviewImageUrl(p) || undefined} alt={p.name} className="w-full h-full object-cover" />
                          )}
                        </div>
                        <div className="p-3">
                          <p className="text-[10px] uppercase tracking-widest text-sky-700 font-semibold">Transport</p>
                          <p className="font-semibold text-sm text-emerald-950 mt-0.5">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.category}</p>
                          <p className="text-[11px] font-semibold text-sky-800 mt-1">Fare set on booking confirmation</p>
                          <p className="text-[10px] text-slate-500">{String(p?.service_template_key || "transport").replace(/_/g, " ")}</p>
                          <div className="grid grid-cols-1 gap-1 mt-2">
                            <PartnerProductForm
                              product={p}
                              onSaved={loadAll}
                              fixedListingType="service"
                              allowedServiceSectors={["Transport", "Logistics"]}
                              initialServiceSectorFilter="Transport"
                              triggerLabel={noRealImage ? "Upload Image" : "Edit"}
                              dialogTitle="Edit Transport Listing"
                              dialogDescription="Update only this transport listing. Fare confirmation and trip execution stay in the transport tab."
                            />
                            {!noRealImage ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full border-amber-300 text-amber-800 hover:bg-amber-50 h-7 px-2 text-[11px] w-full"
                                onClick={() => deleteTransportImage(p)}
                                data-testid={`del-my-transport-image-${p.id}`}
                              >
                                Delete Image
                              </Button>
                            ) : null}
                            <Button size="sm" variant="outline" className="rounded-full border-red-300 text-red-700 hover:bg-red-50 h-7 px-2 text-[11px] w-full" onClick={() => deleteProduct(p.id)} data-testid={`del-my-transport-${p.id}`}>Delete</Button>
                          </div>
                        </div>
                      </div>
                      );
                    })}
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

            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTransportStatusFilter("all")}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${transportStatusFilter === "all" ? "bg-emerald-900 text-white border-emerald-900" : "bg-white text-slate-700 border-slate-300"}`}
                >
                  All ({sortedTransportTrips.length})
                </button>
                {Object.entries(TRANSPORT_STATUS_META).map(([statusKey, meta]) => (
                  <button
                    key={statusKey}
                    type="button"
                    onClick={() => setTransportStatusFilter(statusKey)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${transportStatusFilter === statusKey ? "bg-emerald-900 text-white border-emerald-900" : "bg-white text-slate-700 border-slate-300"}`}
                  >
                    {meta.label} ({transportStatusCounts?.[statusKey] || 0})
                  </button>
                ))}
              </div>
            </div>

            {loadingTransport ? (
              <p className="text-sm text-slate-500 mt-4">Loading transport bookings...</p>
            ) : (transportData?.items || []).length === 0 ? (
              <p className="text-sm text-muted-foreground mt-4">No transport bookings yet.</p>
            ) : visibleTransportTrips.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-4">No booking in selected filter.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {visibleTransportTrips.map((trip) => {
                  const required = Number(trip?.required_commission_reserve || 0);
                  const fare = Number(trip?.fare_final || trip?.fare_quote || 0);
                  const walletBalance = Number(transportData?.wallet?.balance || 0);
                  const status = String(trip?.status || "booked");
                  const walletShort = status === "booked" && required > 0 && walletBalance + 1e-9 < required;
                  const statusMeta = TRANSPORT_STATUS_META?.[status] || { label: status, tone: "bg-slate-100 text-slate-700 border-slate-200" };
                  return (
                    <div key={trip.id} className="rounded-xl border border-border p-4" data-testid={`partner-trip-${trip.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-xs text-emerald-800">{trip.trip_code || trip.id}</p>
                          <p className="font-semibold text-emerald-950 mt-1">{trip.service_name || "Transport Service"} · {trip.vehicle_type || "cab"}</p>
                          <p className="text-xs text-slate-600 mt-1">{trip.pickup} -> {trip.destination}</p>
                          <p className="text-xs text-slate-600">Customer: {trip.customer_name || "Customer"}{trip.customer_phone ? ` (${trip.customer_phone})` : ""}</p>
                          {trip?.travel_date ? <p className="text-xs text-slate-600">Schedule: {String(trip.travel_date)}</p> : null}
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
                          <span className={`inline-flex mt-1 items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-semibold ${statusMeta.tone}`}>
                            <Clock3 className="w-3.5 h-3.5" /> {statusMeta.label}
                          </span>
                          <p className="text-xs text-slate-600 mt-1">Fare: {inr(fare)}</p>
                          <p className="text-xs text-amber-700">Reserve needed: {inr(required)}</p>
                          {walletShort ? (
                            <p className="text-xs font-semibold text-red-700 mt-1">Wallet balance low. Please top up wallet before confirming.</p>
                          ) : null}
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
                          <Button className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" onClick={() => confirmTripBooking(trip.id)} disabled={walletShort}>
                            <CheckCircle2 className="w-4 h-4 mr-1" /> {walletShort ? "Wallet topup korun" : "Confirm + Lock Fare + Auto Approve"}
                          </Button>
                        </div>
                      ) : null}

                      {status === "booked" ? (
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                          <Input
                            value={rejectReasonDrafts?.[trip.id] || ""}
                            onChange={(e) => setRejectReasonDrafts((prev) => ({ ...prev, [trip.id]: e.target.value }))}
                            placeholder="Reject reason (optional)"
                            className="h-10"
                          />
                          <Button variant="outline" className="rounded-full border-rose-300 text-rose-700 hover:bg-rose-50" onClick={() => rejectTripBooking(trip.id)}>
                            <XCircle className="w-4 h-4 mr-1" /> Reject Request
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

                      {status === "rejected" ? (
                        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                          <p className="font-semibold">Booking rejected</p>
                          <p className="mt-1">Reason: {trip?.response_note || "Not specified"}</p>
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
            {normalizedLedger.length === 0 ? (
              <p className="text-sm text-muted-foreground">No entries yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left">
                  <tr><th className="px-3 py-2 text-xs uppercase">Date</th><th className="px-3 py-2 text-xs uppercase">Period</th><th className="text-right px-3 py-2 text-xs uppercase">Sales</th><th className="text-right px-3 py-2 text-xs uppercase">Rate</th><th className="text-right px-3 py-2 text-xs uppercase">Commission</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {normalizedLedger.map((e, i) => (
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
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <h3 className="font-display font-bold text-emerald-950 text-lg">Orders including your products</h3>
              <Button type="button" onClick={saveOrdersShortcut} variant="outline" className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50" data-testid="save-orders-shortcut">
                Save New Orders Shortcut
              </Button>
            </div>
            {normalizedOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <div className="space-y-3">
                {normalizedOrders.map(o => (
                  <div key={o.id} className="border border-border rounded-lg p-4 flex flex-wrap justify-between gap-3" data-testid={`partner-order-${o.id}`}>
                    <div>
                      <p className="font-mono text-xs text-emerald-800">{o.order_no}</p>
                      <p className="text-xs text-muted-foreground">Status: {String(o?.status || "pending_approval").toUpperCase()}</p>
                      <p className="text-xs text-slate-700 mt-0.5">Payment: {paymentModeLabel(o.payment_method)}</p>
                      <p className="text-xs text-slate-700 mt-1">Customer: {o.delivery_name || "Customer"}</p>
                      <p className="text-xs text-slate-700 mt-0.5">Phone: {o.delivery_phone || "Not available"}</p>
                      <p className="text-xs text-slate-700 mt-0.5 whitespace-pre-line">Address: {o.delivery_address || "Address not available"}</p>
                      {Array.isArray(o.my_items) && o.my_items.length > 0 ? (
                        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                          {o.my_items.map((it, idx) => (
                            <p key={`${o.id}-it-${idx}`} className="text-[11px] text-slate-700">
                              {it.product_name || "Item"} x {Number(it.quantity || 0)}
                            </p>
                          ))}
                          <p className="text-[11px] font-semibold text-emerald-800 mt-1">Partner Total: ₹{Number(o.my_sales || 0).toLocaleString("en-IN")}</p>
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right">
                      {o.customer_whatsapp_invoice_url ? (
                        <button
                          type="button"
                          onClick={() => sendInvoicePdfOnWhatsApp(o)}
                          disabled={sendingInvoiceOrderId === o.id}
                          className="inline-flex items-center rounded-full bg-green-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-70"
                          data-testid={`send-invoice-pdf-whatsapp-${o.id}`}
                        >
                          <MessageCircle className="w-3.5 h-3.5 mr-1" /> {sendingInvoiceOrderId === o.id ? "Preparing PDF..." : "Send Invoice PDF WhatsApp"}
                        </button>
                      ) : null}
                      <p className="text-[11px] text-amber-700 mt-1">Invoice, commission, and sales breakdown still hidden.</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {ordersShortcutPinned ? (
          <button
            type="button"
            onClick={() => setTab("orders")}
            className="md:hidden fixed bottom-20 left-4 z-40 rounded-full bg-emerald-900 text-white px-4 py-2 text-xs font-semibold shadow-lg"
            data-testid="mobile-new-orders-shortcut"
          >
            New Orders
          </button>
        ) : null}

      </main>
    </div>
  );
}


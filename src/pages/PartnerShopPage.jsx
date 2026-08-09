import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Building2, MapPin, Phone, ArrowLeft, Store, ShoppingCart, Plus, Minus, Navigation, Share2, LogIn, MessageCircle, Gift, Star, Images, Search, FileText, CalendarCheck2, X } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import UpiPaymentDialog from "@/components/UpiPaymentDialog";
import { resolveAssetUrl, getAssetImageFallbackCandidates } from "@/lib/utils";
import { inferPartnerPrimarySector, getPartnerVisibleSectors, isDoorstepServiceLike, isHospitalityServiceLike, isTransportServiceLike, PARTNER_SECTOR_KEYS } from "@/lib/partnerSector";

const mapsUrl = (p) => {
  const q = [p.business_name, p.address, p.city, p.state].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};
const routeMapsUrl = (pickup, destination) => {
  const origin = String(pickup || "").trim();
  const dest = String(destination || "").trim();
  if (!origin && !dest) return "";
  if (!dest) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(origin)}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=driving`;
};
const formatTransportSchedule = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};
const getTransportRatePerKm = (service) => {
  const candidates = [
    service?.transport_rate_per_km,
    service?.rate_per_km,
    service?.per_km_rate,
    service?.price_per_km,
    service?.transport_rate,
    service?.km_rate,
    service?.price,
  ];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 20;
};
const geocodeAddress = async (address) => {
  const query = String(address || "").trim();
  if (!query) return null;
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const first = Array.isArray(data) ? data[0] : null;
    if (!first) return null;
    const lat = Number(first.lat);
    const lon = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch {
    return null;
  }
};
const estimateTransportFareFromRoute = async (pickup, destination, service) => {
  const origin = String(pickup || "").trim();
  const dest = String(destination || "").trim();
  if (!origin || !dest) return null;
  try {
    const [originCoords, destCoords] = await Promise.all([geocodeAddress(origin), geocodeAddress(dest)]);
    if (!originCoords || !destCoords) return null;
    const distanceKm = haversineKm(originCoords.lat, originCoords.lon, destCoords.lat, destCoords.lon);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
    const ratePerKm = getTransportRatePerKm(service);
    const amount = Math.max(1, Math.round(distanceKm * ratePerKm));
    return {
      amount,
      distanceKm,
      ratePerKm,
      source: "route",
    };
  } catch {
    return null;
  }
};
const PDF_PREVIEW = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23f1f5f9'/><rect x='80' y='50' width='240' height='300' rx='14' fill='%23ffffff' stroke='%2394a3b8' stroke-width='4'/><text x='200' y='190' text-anchor='middle' fill='%23dc2626' font-size='46' font-family='Arial' font-weight='bold'>PDF</text><text x='200' y='228' text-anchor='middle' fill='%23334155' font-size='16' font-family='Arial'>Tap to Open</text></svg>";
const PRODUCT_FALLBACK = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%25' stop-color='%23ecfeff'/><stop offset='100%25' stop-color='%23dcfce7'/></linearGradient></defs><rect width='400' height='400' fill='url(%23g)'/><circle cx='200' cy='150' r='72' fill='%23059669' opacity='0.12'/><text x='200' y='150' text-anchor='middle' dominant-baseline='middle' fill='%230f766e' font-size='46' font-family='Arial' font-weight='700'>M</text><text x='200' y='230' text-anchor='middle' fill='%230f172a' font-size='22' font-family='Arial' font-weight='700'>METHO Product</text></svg>";
const cleanPhone = (v) => (v || "").replace(/[^\d]/g, "");
const waUrl = (p) => {
  const n = cleanPhone(p.whatsapp_no || p.phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(`Hi ${p.business_name}, I found your shop on METHOO STORE`)}` : null;
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

const isPdfUrl = (value) => /\.pdf($|\?)/i.test(String(value || ""));

const getUnitType = (item) => {
  const unit = String(item?.unit_type || "piece").trim().toLowerCase();
  if (["kg", "gram", "litre", "ml", "piece"].includes(unit)) return unit;
  return "piece";
};

const getMeasureUnitStep = (measureUnit) => {
  const unit = String(measureUnit || "").trim().toLowerCase();
  if (unit === "kg" || unit === "litre") return 1;
  if (unit === "gram" || unit === "ml") return 100;
  return 1;
};

const getQtyStep = (item, measureUnit = "") => {
  const unit = getUnitType(item);
  const resolvedMeasureUnit = ["kg", "gram", "litre", "ml", "piece"].includes(String(measureUnit || "").trim().toLowerCase())
    ? String(measureUnit).trim().toLowerCase()
    : unit;
  if (unit === "piece") {
    const configured = Number(item?.quantity_step || 0);
    return Number.isFinite(configured) && configured > 0 ? Math.max(1, Math.round(configured)) : 1;
  }
  return Number(convertQtyBetweenUnits(getMeasureUnitStep(resolvedMeasureUnit), resolvedMeasureUnit, unit).toFixed(3));
};

const normalizeQtyByUnit = (value, item) => {
  const step = getQtyStep(item);
  const unit = getUnitType(item);
  const raw = Number(value || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (unit === "piece" || step === 1) return Math.max(0, Math.round(raw));
  const units = Math.round(raw / step);
  const next = units * step;
  return Number(next.toFixed(3));
};

const formatQty = (qty) => {
  const n = Number(qty || 0);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
};

const formatPriceWithUnit = (price, unitType) => {
  const unit = getUnitType({ unit_type: unitType });
  return unit === "piece" ? `₹${price}` : `₹${price} / ${unit}`;
};

const getProductImageUrl = (product) => {
  const url = firstValidAssetRef(
    product?.image_url,
    product?.product_image_url,
    product?.image,
    product?.thumbnail_url,
    product?.thumb_url,
    product?.cover_url,
    product?.photo_url
  );
  return isPdfUrl(url) ? "" : url;
};

const getDisplayImage = (product, placeholder) => {
  const image = getProductImageUrl(product);
  if (image) return image;
  if (product?.fallback_image_url) return resolveAssetUrl(product.fallback_image_url);
  if (getPdfUrl(product)) return PRODUCT_FALLBACK;
  return placeholder || PRODUCT_FALLBACK;
};

const applyImageFallback = (event, fallbackUrl, finalFallback = "") => {
  const target = event.currentTarget;
  const candidates = getAssetImageFallbackCandidates(target.src, [fallbackUrl, finalFallback, PRODUCT_FALLBACK]);
  const tried = Number(target.dataset.fallbackIndex || "0");
  for (let i = tried; i < candidates.length; i += 1) {
    const next = String(candidates[i] || "").trim();
    if (!next || next === target.src) continue;
    target.dataset.fallbackIndex = String(i + 1);
    target.src = next;
    return;
  }
  const last = String(finalFallback || PRODUCT_FALLBACK).trim();
  if (last && target.src !== last) {
    target.src = last;
  }
};

const pickImageUrl = (value) => {
  if (!value) return "";
  if (typeof value === "string") return isLikelyAssetRef(value) ? resolveAssetUrl(value) : "";
  if (typeof value === "object") {
    return firstValidAssetRef(
      value.url,
      value.image_url,
      value.featured_image_url,
      value.path,
      value.file_url,
      value.public_url,
      value.secure_url,
      value.src,
      value.image,
      value.link
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

const isServiceListing = (item) => {
  if (!item) return false;
  const hint = [item?.listing_type, item?.item_kind, item?.kind, item?.type, item?.product_kind]
    .find((v) => typeof v === "string" && v.trim());
  if (String(hint || "").toLowerCase().includes("service")) return true;
  if (item?.is_service === true || item?.service_booking_enabled === true) return true;
  return false;
};

const isTransportServiceListing = (item) => {
  return isTransportServiceLike(item);
};
const isHospitalityServiceListing = (item) => {
  return isHospitalityServiceLike(item);
};
const isDoorstepServiceListing = (item) => {
  return isDoorstepServiceLike(item);
};

const normalizePartnerPayload = (payload) => {
  const partner = payload?.partner || {};
  const featuredImages = normalizeFeaturedImages(payload?.featured_images || payload?.partner?.featured_images);
  const bannerFallback = firstValidAssetRef(partner?.banner_url, partner?.shop_banner_url, partner?.banner, partner?.cover_url);
  const logoFallback = firstValidAssetRef(partner?.logo_url, partner?.logo, partner?.shop_logo_url);
  const fallbackPool = [...featuredImages, bannerFallback, logoFallback].filter(Boolean);
  const products = Array.isArray(payload?.products)
    ? payload.products.map((item, index) => {
      const resolvedImage = getProductImageUrl(item);
      const fallbackImage = fallbackPool[index % Math.max(1, fallbackPool.length)] || "";
      return {
        ...item,
        image_url: resolvedImage || "",
        fallback_image_url: fallbackImage,
        pdf_url: getPdfUrl(item),
      };
    })
    : [];
  return {
    ...payload,
    partner: {
      ...partner,
      logo_url: firstValidAssetRef(partner?.logo_url, partner?.logo, partner?.shop_logo_url),
      banner_url: firstValidAssetRef(partner?.banner_url, partner?.shop_banner_url, partner?.banner, partner?.cover_url) || firstValidAssetRef(partner?.logo_url, partner?.logo, partner?.shop_logo_url),
    },
    products,
    featured_images: featuredImages,
  };
};

export default function PartnerShopPage() {
  const { partnerCode } = useParams();
  const { user } = useAuth();
  const { settings } = useSettings();
  const placeholder = settings?.product_placeholder_image_url_full;
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [paymentProfile, setPaymentProfile] = useState(null);
  const [offerPopup, setOfferPopup] = useState(null);
  const [showOfferPopup, setShowOfferPopup] = useState(false);
  const [err, setErr] = useState(null);
  const [cart, setCart] = useState({});
  const [previewItem, setPreviewItem] = useState(null);
  const [open, setOpen] = useState(false);
  const [guestMemberRef, setGuestMemberRef] = useState("");
  const [cashback, setCashback] = useState(null); // {percent, max, eligible}
  const [productSearch, setProductSearch] = useState("");
  const [transportSearch, setTransportSearch] = useState("");
  const [hospitalitySearch, setHospitalitySearch] = useState("");
  const [doorstepSearch, setDoorstepSearch] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [transportService, setTransportService] = useState(null);
  const [transportBookingMode, setTransportBookingMode] = useState("route");
  const [transportBusy, setTransportBusy] = useState(false);
  const [transportBooking, setTransportBooking] = useState(null);
  const [transportFarePresets, setTransportFarePresets] = useState([]);
  const [selectedFarePresetId, setSelectedFarePresetId] = useState("");
  const [transportActiveTab, setTransportActiveTab] = useState("services");
  const [transportServiceSearch, setTransportServiceSearch] = useState("");
  const [transportForm, setTransportForm] = useState({
    customer_name: "",
    customer_phone: "",
    pickup: "",
    destination: "",
    travel_date: "",
    notes: "",
  });
  const [transportFareEstimate, setTransportFareEstimate] = useState(null);
  const [transportFareEstimateLoading, setTransportFareEstimateLoading] = useState(false);
  const transportEstimateRequestRef = useRef(0);

  useEffect(() => {
    api.get(`/directory/partner/${partnerCode}`)
      .then(r => setData(normalizePartnerPayload(r.data)))
      .catch(e => setErr(e?.response?.data?.detail || "Shop not found"));
  }, [partnerCode]);

  useEffect(() => {
    api.get(`/partner/public-payment-profile/${partnerCode}`)
      .then((r) => {
        setPaymentProfile(r.data);
        setOfferPopup(r.data?.offer_popup || null);
      })
      .catch(() => {
        setPaymentProfile(null);
        setOfferPopup(null);
      });
  }, [partnerCode]);

  useEffect(() => {
    const enabled = offerPopup?.enabled === true;
    const title = String(offerPopup?.title || "").trim();
    const message = String(offerPopup?.message || "").trim();
    if (!enabled || (!title && !message)) {
      setShowOfferPopup(false);
      return;
    }
    setShowOfferPopup(true);
  }, [offerPopup, partnerCode]);

  const closeOfferPopup = () => {
    setShowOfferPopup(false);
  };

  // Load cashback offer (public setting) + user's eligibility (only if logged in as member)
  useEffect(() => {
    api.get("/settings").then(r => {
      const pct = Number(r.data?.first_partner_order_cashback_percent) || 0;
      const max = Number(r.data?.first_partner_order_cashback_max) || 0;
      if (pct > 0) setCashback(c => ({ ...(c || {}), percent: pct, max }));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user || user.role !== "member") return;
    api.get("/auth/me").then(r => {
      setCashback(c => ({ ...(c || {}), eligible: !r.data?.first_partner_cashback_credited }));
    }).catch(() => {});
  }, [user]);

  const p = data?.partner;
  const heroBannerSrc = data?.partner?.banner_url || "";
  const selectedTransportPreset = useMemo(() => {
    if (!Array.isArray(transportFarePresets) || !transportFarePresets.length) return null;
    return transportFarePresets.find((preset) => String(preset.id) === String(selectedFarePresetId)) || null;
  }, [selectedFarePresetId, transportFarePresets]);
  const transportEstimateSummary = useMemo(() => {
    if (transportFareEstimateLoading) {
      return {
        label: "Estimating route fare...",
        detail: "Checking pickup and destination route.",
      };
    }
    if (transportFareEstimate?.amount) {
      const distanceText = Number.isFinite(transportFareEstimate.distanceKm) && transportFareEstimate.distanceKm > 0
        ? ` · ${Number(transportFareEstimate.distanceKm).toFixed(1)} km route`
        : "";
      const rateText = Number.isFinite(transportFareEstimate.ratePerKm) && transportFareEstimate.ratePerKm > 0
        ? ` · ₹${Number(transportFareEstimate.ratePerKm).toLocaleString("en-IN")}/km`
        : "";
      return {
        label: `Estimated fare: ₹${Number(transportFareEstimate.amount).toLocaleString("en-IN")}${distanceText}${rateText}`,
        detail: "Approximate fare from pickup and destination route.",
      };
    }
    return {
      label: "Estimated fare will appear after pickup and destination",
      detail: "Final fare will be confirmed by partner after request.",
    };
  }, [selectedTransportPreset, transportFareEstimate, transportFareEstimateLoading]);
  const products = useMemo(() => data?.products || [], [data?.products]);
  const productListings = useMemo(() => products.filter((item) => !isServiceListing(item)), [products]);
  const serviceListings = useMemo(() => products.filter((item) => isServiceListing(item)), [products]);
  const transportListings = useMemo(() => serviceListings.filter((item) => isTransportServiceListing(item)), [serviceListings]);
  const hospitalityListings = useMemo(() => serviceListings.filter((item) => !isTransportServiceListing(item) && isHospitalityServiceListing(item)), [serviceListings]);
  const doorstepListings = useMemo(() => serviceListings.filter((item) => !isTransportServiceListing(item) && !isHospitalityServiceListing(item) && isDoorstepServiceListing(item)), [serviceListings]);
  const regularServiceListings = useMemo(() => serviceListings.filter((item) => !isTransportServiceListing(item) && !isHospitalityServiceListing(item) && !isDoorstepServiceListing(item)), [serviceListings]);
  const primarySector = useMemo(() => inferPartnerPrimarySector({
    businessType: data?.partner?.business_type,
    businessName: data?.partner?.business_name,
    counts: {
      products: productListings.length,
      transport: transportListings.length,
      hospitality: hospitalityListings.length,
      doorstep: doorstepListings.length,
      otherServices: regularServiceListings.length,
    },
  }), [
    data?.partner?.business_type,
    data?.partner?.business_name,
    productListings.length,
    transportListings.length,
    hospitalityListings.length,
    doorstepListings.length,
    regularServiceListings.length,
  ]);
  const visibleSectors = useMemo(() => getPartnerVisibleSectors(primarySector), [primarySector]);
  const canShowProducts = visibleSectors.includes(PARTNER_SECTOR_KEYS.PRODUCT_SECTOR);
  const canShowTransport = visibleSectors.includes(PARTNER_SECTOR_KEYS.TRANSPORT_SECTOR);
  const canShowHospitality = visibleSectors.includes(PARTNER_SECTOR_KEYS.HOSPITALITY_SECTOR);
  const canShowDoorstep = visibleSectors.includes(PARTNER_SECTOR_KEYS.DOORSTEP_SECTOR);
  const canShowOtherServices = visibleSectors.includes(PARTNER_SECTOR_KEYS.OTHER_SERVICE_SECTOR);
  const normalizedRole = String(user?.role || "").toLowerCase();
  const isMemberOrCustomer = normalizedRole === "member" || normalizedRole === "customer";
  const defaultGalleryTab = canShowTransport
    ? "transport"
    : (canShowHospitality
      ? "stay-dining"
      : (canShowDoorstep ? "doorstep" : (canShowOtherServices ? "other-services" : "products")));
  const featuredImages = useMemo(() => normalizeFeaturedImages(data?.featured_images), [data?.featured_images]);
  const featuredDisplayImages = useMemo(
    () => [0, 1, 2, 3, 4].map((slot) => featuredImages[slot] || ""),
    [featuredImages]
  );
  const hasAnyFeaturedImage = useMemo(() => featuredDisplayImages.some(Boolean), [featuredDisplayImages]);
  const getStock = (product) => Math.max(0, Number(product?.stock ?? 0));
  const isBookNowRole = !user || isMemberOrCustomer;
  const canAccessProductPdf = ["partner", "admin", "super_admin", "company_admin"].includes(String(user?.role || "").toLowerCase());
  const filteredHospitality = useMemo(() => {
    const q = hospitalitySearch.trim().toLowerCase();
    if (!q) return hospitalityListings;
    return hospitalityListings.filter((p) => {
      const haystack = [data?.partner?.business_name, p?.name, p?.category, p?.description]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [data?.partner?.business_name, hospitalityListings, hospitalitySearch]);
  const filteredDoorstep = useMemo(() => {
    const q = doorstepSearch.trim().toLowerCase();
    if (!q) return doorstepListings;
    return doorstepListings.filter((p) => {
      const haystack = [data?.partner?.business_name, p?.name, p?.category, p?.description]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [data?.partner?.business_name, doorstepListings, doorstepSearch]);
  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return regularServiceListings;
    return regularServiceListings.filter((p) => {
      const haystack = [data?.partner?.business_name, p?.name, p?.category, p?.description]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [data?.partner?.business_name, regularServiceListings, serviceSearch]);
  const filteredTransport = useMemo(() => {
    const q = transportSearch.trim().toLowerCase();
    if (!q) return transportListings;
    return transportListings.filter((p) => {
      const haystack = [data?.partner?.business_name, p?.name, p?.category, p?.description, p?.service_template_key]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [data?.partner?.business_name, transportListings, transportSearch]);
  const filteredTransportServiceOptions = useMemo(() => {
    const q = String(transportServiceSearch || "").trim().toLowerCase();
    if (!q) return transportListings.slice(0, 8);
    return transportListings.filter((item) => {
      const haystack = [item?.name, item?.category, item?.description, item?.service_template_key]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    }).slice(0, 8);
  }, [transportListings, transportServiceSearch]);

  useEffect(() => {
    if (!transportService?.id) {
      setTransportFareEstimate(null);
      setTransportFareEstimateLoading(false);
      return;
    }

    const pickup = String(transportForm.pickup || "").trim();
    const destination = String(transportForm.destination || "").trim();
    const presetFare = Number(selectedTransportPreset?.fare || 0);

    if (!pickup || !destination) {
      setTransportFareEstimate(null);
      setTransportFareEstimateLoading(false);
      return;
    }

    const requestId = transportEstimateRequestRef.current + 1;
    transportEstimateRequestRef.current = requestId;
    setTransportFareEstimateLoading(true);

    let cancelled = false;
    void estimateTransportFareFromRoute(pickup, destination, transportService)
      .then((estimate) => {
        if (cancelled || requestId !== transportEstimateRequestRef.current) return;
        setTransportFareEstimate(estimate || null);
      })
      .catch(() => {
        if (!cancelled && requestId === transportEstimateRequestRef.current) {
          setTransportFareEstimate(null);
        }
      })
      .finally(() => {
        if (!cancelled && requestId === transportEstimateRequestRef.current) {
          setTransportFareEstimateLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFarePresetId, selectedTransportPreset, transportForm.destination, transportForm.pickup, transportService]);
  const hasHospitalityListings = hospitalityListings.length > 0;
  const hasDoorstepListings = doorstepListings.length > 0;
  const hasServiceListings = regularServiceListings.length > 0;
  const hasTransportListings = transportListings.length > 0;

  const selectTransportBookingService = (nextService) => {
    setTransportService(nextService || null);
    setTransportServiceSearch("");
    setTransportBookingMode("route");
    setSelectedFarePresetId("");
    setTransportFarePresets([]);
    setTransportBooking(null);
    setTransportForm((prev) => ({
      ...prev,
      pickup: "",
      destination: "",
      travel_date: "",
      notes: "",
    }));
    if (nextService?.id) void loadTransportFarePresets(nextService.id);
  };

  const inc = (product) => {
    const id = product?.id;
    if (!id) return;
    const stock = getStock(product);
    const step = getQtyStep(product);
    if (stock <= 0) {
      toast.error(`${product?.name || "Product"}: out of stock`);
      return;
    }
    const current = Number(cart[id] || 0);
    const nextQty = normalizeQtyByUnit(current + step, product);
    if (nextQty > stock) {
      toast.error(`${product?.name || "Product"}: max available stock is ${stock}`);
      return;
    }
    setCart({ ...cart, [id]: nextQty });
  };
  const dec = (product) => {
    const id = product?.id;
    if (!id) return;
    const current = Number(cart[id] || 0);
    const nextQty = normalizeQtyByUnit(current - getQtyStep(product), product);
    setCart({ ...cart, [id]: Math.max(0, nextQty) });
  };

  const items = useMemo(() =>
    Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => {
        const pr = products.find(x => String(x.id) === String(id));
        const subtotal = Number(((pr?.price || 0) * q).toFixed(2));
        return {
          ...pr,
          quantity: q,
          subtotal,
          pdf_url: getPdfUrl(pr),
          listing_type: isServiceListing(pr) ? "service" : "product",
          item_kind: isServiceListing(pr) ? "service" : "product",
          is_service: isServiceListing(pr),
          service_invoice_mode: String(pr?.service_invoice_mode || "detailed").toLowerCase(),
          service_template_key: String(pr?.service_template_key || ""),
        };
      }),
    [cart, products]
  );
  const total = items.reduce((s, i) => s + i.subtotal, 0);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: p.business_name, url });
      else { await navigator.clipboard.writeText(url); toast.success("Shop link copied"); }
    } catch { /* user cancelled */ }
  };

  const openGallery = (searchValue = "", tab = defaultGalleryTab) => {
    const next = searchValue.trim();
    const params = new URLSearchParams();
    if (next) params.set("q", next);
    const resolvedTab = ["products", "transport", "stay-dining", "doorstep", "other-services"].includes(String(tab || "")) ? tab : defaultGalleryTab;
    params.set("tab", resolvedTab);
    nav(`/gallery/${partnerCode}${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const loadTransportFarePresets = async (serviceId) => {
    setTransportFarePresets([]);
  };

  const openTransportBookingDesk = (service) => {
    if (!service?.id) return;
    setTransportService(service);
    setTransportServiceSearch("");
    setTransportBookingMode("route");
    setTransportForm({
      customer_name: isMemberOrCustomer ? (user?.name || "") : "",
      customer_phone: isMemberOrCustomer ? (user?.phone || "") : "",
      pickup: "",
      destination: "",
      travel_date: "",
      notes: "",
    });
    setSelectedFarePresetId("");
    setTransportFarePresets([]);
    setTransportBooking(null);
    setTransportActiveTab("booking");
    void loadTransportFarePresets(service.id);
    window.requestAnimationFrame(() => {
      document.getElementById("transport-booking-desk")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const bookServiceNow = (service) => {
    if (!service?.id) return;
    if (isTransportServiceListing(service)) {
      openTransportBookingDesk(service);
      return;
    }
    setCart((prev) => ({ ...prev, [service.id]: 1 }));
    setOpen(true);
    if (!user) {
      toast.info("Guest mode active: reward attribution-এর জন্য checkout-এ Member ID/Code দিন");
    }
    toast.success(`${service.name || "Service"} booking started`);
  };

  const submitTransportBooking = async () => {
    const bookingService = transportService
      || filteredTransportServiceOptions[0]
      || transportListings[0]
      || null;
    const derivedPickup = String(transportForm.pickup || "").trim();
    const derivedDestination = String(transportForm.destination || "").trim();
    if (!bookingService?.id) {
      toast.error("Transport service select করুন অথবা service name লিখুন");
      return;
    }
    if (!transportForm.customer_name.trim()) {
      toast.error("Customer name দিন");
      return;
    }
    if (!transportForm.customer_phone.trim()) {
      toast.error("Mobile number দিন");
      return;
    }
    if (!derivedPickup) {
      toast.error("Pickup দিন");
      return;
    }
    if (!derivedDestination) {
      toast.error("Destination দিন");
      return;
    }
    setTransportBusy(true);
    try {
      if (!transportService?.id) {
        setTransportService(bookingService);
        setTransportServiceSearch("");
        setTransportBookingMode("route");
        void loadTransportFarePresets(bookingService.id);
      }
      const manualMemberRef = String(guestMemberRef || "").trim();
      const autoMemberRef = normalizedRole === "member" ? String(user?.id || "").trim() : "";
      const routeEstimatedFare = Number(transportFareEstimate?.amount || 0);
      const routeDistanceKm = Number(transportFareEstimate?.distanceKm || 0);
      const routeRatePerKm = Number(transportFareEstimate?.ratePerKm || 0);
      const { data } = await api.post("/transport/bookings", {
        partner_code: partnerCode,
        service_product_id: bookingService.id,
        vehicle_type: String(bookingService?.service_template_key || "cab").includes("bike") ? "bike_rental" : String(bookingService?.service_template_key || "cab").includes("car") ? "car_rental" : "cab",
        customer_name: transportForm.customer_name,
        customer_phone: transportForm.customer_phone,
        pickup: derivedPickup,
        destination: derivedDestination,
        fare_preset_id: "",
        travel_date: transportForm.travel_date,
        notes: transportForm.notes,
        member_ref: manualMemberRef || autoMemberRef,
        estimated_fare: transportFareEstimate?.source === "route" && routeEstimatedFare > 0 ? routeEstimatedFare : null,
        estimated_distance_km: transportFareEstimate?.source === "route" && routeDistanceKm > 0 ? routeDistanceKm : null,
        estimated_rate_per_km: transportFareEstimate?.source === "route" && routeRatePerKm > 0 ? routeRatePerKm : null,
      });
      setTransportBooking(data?.booking || null);
      toast.success("Transport booking submitted");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Transport booking failed");
    } finally {
      setTransportBusy(false);
    }
  };

  const refreshTransportBooking = async () => {
    const id = String(transportBooking?.id || "").trim();
    if (!id) return;
    try {
      const phone = String(transportForm?.customer_phone || transportBooking?.customer_phone || "").trim();
      const { data } = await api.get(`/transport/bookings/${id}`, {
        params: !user ? { customer_phone: phone } : undefined,
      });
      setTransportBooking(data?.booking || null);
      if (String(data?.booking?.status || "") === "completed") {
        toast.success("Driver is waiting for payment QR flow at destination");
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Refresh failed");
    }
  };

  const closePreview = () => setPreviewItem(null);

  if (err) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
      <p className="text-red-700 font-semibold">{err}</p>
      <Link to="/directory" className="mt-4 text-emerald-800 hover:underline text-sm">← Back to directory</Link>
    </div>
  );
  if (!data) return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading shop...</div>;

  const addr = [p.address, p.city, p.state, p.pincode].filter(Boolean).join(", ");

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-8" data-testid="partner-shop-page">
      <header className="bg-emerald-950 text-white sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/directory" className="flex items-center gap-2 text-sm hover:text-amber-400" data-testid="back-to-directory">
            <ArrowLeft className="w-4 h-4" /> Directory
          </Link>
          <Logo />
        </div>
      </header>

      {showOfferPopup && offerPopup?.enabled ? (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={closeOfferPopup}>
          <div className="w-full max-w-md rounded-2xl bg-white border border-emerald-200 shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-emerald-700 font-bold">Special Offer</p>
                <h3 className="font-display font-black text-xl text-emerald-950 mt-1">{offerPopup?.title || "Offer"}</h3>
              </div>
              <button
                type="button"
                onClick={closeOfferPopup}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center"
                aria-label="Close offer popup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {offerPopup?.message ? <p className="text-sm text-slate-700 mt-3">{offerPopup.message}</p> : null}
            {offerPopup?.coupon_code ? (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-widest text-amber-700 font-bold">Coupon Code</p>
                <p className="font-mono font-bold text-amber-900 mt-1">{offerPopup.coupon_code}</p>
              </div>
            ) : null}
            <div className="mt-4 flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={closeOfferPopup} className="rounded-full">Later</Button>
              <Button type="button" onClick={closeOfferPopup} className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white">
                {offerPopup?.cta_text || "Shop Now"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* SHOP HERO */}
      <div className="bg-gradient-to-br from-emerald-900 to-emerald-950 text-white relative overflow-hidden">
        {heroBannerSrc ? (
          <div className="absolute inset-0 opacity-25">
            <img
              src={heroBannerSrc}
              alt="Shop banner"
              className="w-full h-full object-cover"
              onError={(e) => {
                applyImageFallback(e, p.logo_url || "", placeholder || "");
              }}
            />
            <div className="absolute inset-0 bg-emerald-950/55" />
          </div>
        ) : null}
        <div className="max-w-6xl mx-auto px-4 py-8 md:py-10 relative">
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-amber-400 text-emerald-950 flex items-center justify-center shrink-0 overflow-hidden">
              {p.logo_url ? <img src={p.logo_url} alt="" className="w-full h-full object-cover" /> : <Building2 className="w-10 h-10" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-[0.3em] text-amber-400 font-bold flex items-center gap-2">
                {p.partner_code} · Verified Partner
                {p.is_featured && (
                  <span className="inline-flex items-center gap-1 bg-amber-400 text-emerald-950 px-2 py-0.5 rounded-full text-[9px]">
                    <Star className="w-2.5 h-2.5 fill-emerald-950" /> Featured
                  </span>
                )}
              </p>
              <h1 className="font-display font-black text-2xl md:text-4xl mt-1" data-testid="shop-title">{p.business_name}</h1>
              <p className="text-emerald-100/80 mt-1 text-sm capitalize">{p.business_type}{p.contact_person ? ` · ${p.contact_person}` : ""}</p>
              {addr && (
                <p className="mt-3 flex items-start gap-1.5 text-xs text-emerald-100/90 max-w-2xl">
                  <MapPin className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <span data-testid="shop-address">{addr}</span>
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {p.phone && (
              <a
                href={`tel:${p.phone}`}
                className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-xs font-semibold px-4 py-2 transition"
                data-testid="shop-call"
              >
                <Phone className="w-3.5 h-3.5" /> {p.phone}
              </a>
            )}
            {waUrl(p) && (
              <a
                href={waUrl(p)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white border border-green-400 rounded-full text-xs font-bold px-4 py-2 transition"
                data-testid="shop-whatsapp"
              >
                <MessageCircle className="w-3.5 h-3.5" /> Chat with Owner
              </a>
            )}
            <a
              href={mapsUrl(p)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-xs font-semibold px-4 py-2 transition"
              data-testid="shop-address-chip"
            >
              <MapPin className="w-3.5 h-3.5" /> Address
            </a>
            <a
              href={mapsUrl(p)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-xs font-semibold px-4 py-2 transition"
              data-testid="shop-directions"
            >
              <Navigation className="w-3.5 h-3.5" /> Get Directions
            </a>
            <button
              onClick={share}
              className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-xs font-semibold px-4 py-2 transition"
              data-testid="shop-share"
            >
              <Share2 className="w-3.5 h-3.5" /> Share
            </button>
          </div>
        </div>
      </div>

      {!user && (
        <div className="max-w-6xl mx-auto px-4 pt-6">
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-wrap items-center gap-3" data-testid="guest-cta">
            <LogIn className="w-5 h-5 text-amber-700 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-emerald-950 text-sm">Guest checkout is available</p>
              <p className="text-xs text-slate-700 mt-0.5">Buy without login. Add Member ID/Code at checkout only if you want reward percentage attribution.</p>
            </div>
            <Link to={`/login?next=/partner-shop/${partnerCode}`}>
              <Button size="sm" className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full">Sign In (Optional)</Button>
            </Link>
            <Link to="/register">
              <Button size="sm" variant="outline" className="rounded-full border-emerald-900 text-emerald-900 hover:bg-emerald-50">Join Free</Button>
            </Link>
          </div>
        </div>
      )}

      <main className={`max-w-6xl mx-auto px-4 py-8 ${items.length > 0 ? "pt-28 md:pt-8" : ""}`}>
        {hasAnyFeaturedImage && (
          <div className="mb-8 bg-white rounded-xl border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Images className="w-5 h-5 text-emerald-700" />
              <h2 className="font-display font-bold text-2xl text-emerald-950">Best 5 Partner Images</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {[0, 1, 2, 3, 4].map((slot) => {
                const imageSrc = featuredDisplayImages[slot] || "";
                return (
                <div key={`best-product-${slot}`} className="aspect-square rounded-lg overflow-hidden border border-border bg-slate-100 relative">
                  {imageSrc ? (
                    <img
                      src={imageSrc}
                      alt={`Featured ${slot + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        applyImageFallback(
                          e,
                          heroBannerSrc || p?.logo_url || "",
                          placeholder || PRODUCT_FALLBACK
                        );
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs font-semibold">
                      Upload Image
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        )}

        {canShowProducts ? (
        <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr] mb-8">
          <div className="bg-white rounded-xl border border-border p-6" data-testid="partner-shop-left-gallery-panel">
            <div className="flex items-start gap-2 mb-1">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">All Product View</p>
            </div>
            <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">View All Products</h3>
            <p className="text-sm text-slate-600 mt-3">See product details and add-to-cart flow in one place.</p>
            <div className="mt-6">
              <Button onClick={() => openGallery("", "products")} className="w-full bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="partner-gallery-btn">
                <Images className="w-4 h-4 mr-2" /> View All Products
              </Button>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border p-6" data-testid="partner-shop-right-search-panel">
            <div className="flex items-start gap-2 mb-1">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Search & Filter</p>
            </div>
            <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">Product Name / Category</h3>
            <p className="text-sm text-slate-600 mt-3">Filter the gallery by product name or category.</p>
            <div className="mt-6 flex flex-col sm:flex-row gap-2">
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                placeholder="e.g. malt, face care"
                className="h-11 rounded-full text-sm"
                data-testid="partner-shop-product-search"
              />
              <Button
                onClick={() => openGallery(productSearch, "products")}
                className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full shrink-0 w-full sm:w-auto"
                data-testid="partner-shop-product-search-btn"
              >
                Search
              </Button>
            </div>
          </div>
        </div>
        ) : null}

        {/* Cashback banner */}
        {cashback?.percent > 0 && (user?.role !== "member" || cashback.eligible) && (
          <div className="mb-8 rounded-xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-yellow-50 p-5 flex flex-wrap items-center gap-3" data-testid="cashback-banner">
            <div className="w-10 h-10 rounded-full bg-amber-400 text-emerald-950 flex items-center justify-center shrink-0">
              <Gift className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display font-black text-emerald-950 text-sm md:text-base">
                {user?.role === "member" ? "First Partner-shop order?" : "New member offer"} Get {cashback.percent}% cashback
                {cashback.max > 0 ? <span className="text-amber-800"> (up to ₹{cashback.max})</span> : null}
              </p>
              <p className="text-xs text-slate-700 mt-0.5 font-body">
                Auto-credited to your Wallet once your first Partner order is approved. One-time offer per member.
              </p>
            </div>
            {!user && (
              <Link to={`/register`}>
                <Button size="sm" className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full">Join Free →</Button>
              </Link>
            )}
          </div>
        )}
      </main>

      {/* Sticky Cart Bar */}
      {items.length > 0 && (
        <div className="fixed top-14 md:top-auto md:bottom-0 inset-x-0 z-40 bg-emerald-950 text-white shadow-2xl border-b md:border-b-0 md:border-t border-emerald-800" data-testid="sticky-cart-bar">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Cart</p>
              <p className="font-display font-bold text-lg leading-tight">{items.length} item{items.length !== 1 ? "s" : ""} · ₹{total.toLocaleString("en-IN")}</p>
              {!user && <p className="text-[11px] text-emerald-100/80">Guest checkout: reward percentage only if Member ID/Code is provided.</p>}
            </div>
            <Button
              onClick={() => setOpen(true)}
              className="bg-amber-400 hover:bg-amber-500 text-emerald-950 rounded-full font-bold h-11 px-6 w-full sm:w-auto"
              data-testid="shop-checkout"
            >
              <ShoppingCart className="w-4 h-4 mr-2" /> Checkout
            </Button>
          </div>
        </div>
      )}

      {canShowTransport && hasTransportListings ? (
        <>
          <div className="mb-8">
            <div className="bg-white rounded-xl border border-sky-200 p-6" data-testid="partner-shop-transport-panel">
              <div className="flex items-start gap-2 mb-1">
                <p className="text-[10px] uppercase tracking-widest text-sky-700 font-semibold">Transport Services</p>
              </div>
              <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">Book cab, car rental, bike rental easily</h3>
              <p className="text-sm text-slate-600 mt-3">Pickup আর destination দিয়ে ride request দিন। Partner final fare lock করার পর trip approved হবে.</p>
              <div className="mt-5 flex flex-wrap gap-2" data-testid="partner-shop-transport-tabs">
                <button
                  type="button"
                  onClick={() => setTransportActiveTab("services")}
                  className={`rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${transportActiveTab === "services" ? "bg-sky-700 text-white border-sky-700" : "bg-white text-sky-800 border-sky-200 hover:bg-sky-50"}`}
                >
                  Transport Services
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTransportActiveTab("booking");
                    window.requestAnimationFrame(() => {
                      document.getElementById("transport-booking-desk")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${transportActiveTab === "booking" ? "bg-emerald-900 text-white border-emerald-900" : "bg-white text-emerald-900 border-emerald-200 hover:bg-emerald-50"}`}
                >
                  Booking Desk
                </button>
              </div>
              <div className="mt-6 flex flex-col lg:flex-row gap-3 lg:items-center">
                <div className="flex flex-1 gap-2" data-testid="partner-shop-transport-search-panel">
                  <Input
                    value={transportSearch}
                    onChange={(e) => setTransportSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    placeholder="Search cab, rental, bike, cargo"
                    className="h-11 rounded-full text-sm"
                    data-testid="partner-shop-transport-search"
                  />
                  <Button
                    onClick={() => setTransportSearch(String(transportSearch || "").trim())}
                    className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full shrink-0"
                    data-testid="partner-shop-transport-search-btn"
                  >
                    Search
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {transportActiveTab === "booking" ? (
            <section id="transport-booking-desk" className="bg-white rounded-xl border border-emerald-200 p-6 mb-8" data-testid="transport-booking-desk">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Guest / Customer / Member Booking</p>
                  <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">Transport Booking Desk</h3>
                    <p className="text-sm text-slate-600 mt-2">Service template select করে বা pickup/destination দিয়ে booking দিন. দুটো mode-ই একই booking desk থেকে কাজ করবে।</p>
                </div>
                <Button type="button" variant="outline" className="rounded-full" onClick={() => setTransportActiveTab("services")}>
                  Back to Services
                </Button>
              </div>

                <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3">
                  <p className="text-[11px] font-semibold text-sky-900">Default Book Now flow</p>
                  <p className="text-xs text-slate-700 mt-1">Pickup, destination, customer details, and travel date enough. Preset template / service fare setup ছাড়াই simple booking flow থাকবে।</p>
                </div>

              {!user ? <p className="text-[11px] text-amber-700 mt-3">Guest mode active: Member ID/Code দিলে reward attribution হবে, না দিলে guest booking হবে।</p> : null}

              {!transportBooking ? (
                <div className="mt-5 space-y-3">
                  <div>
                    <p className="text-[11px] text-slate-600 mb-1">Select transport service</p>
                    <div className="rounded-xl border border-emerald-200 bg-white p-2">
                      <Input
                        value={transportServiceSearch}
                        onChange={(e) => {
                          setTransportServiceSearch(e.target.value);
                        }}
                        placeholder="Type cab / car rental / bike rental"
                        className="h-10 border-0 px-2 shadow-none focus-visible:ring-0"
                        data-testid="transport-booking-service-select"
                      />
                      <div className="max-h-40 overflow-y-auto border-t border-emerald-100 pt-2">
                        {filteredTransportServiceOptions.length ? filteredTransportServiceOptions.map((service) => (
                          <button
                            key={service.id}
                            type="button"
                            onClick={() => selectTransportBookingService(service)}
                            className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${String(transportService?.id || "") === String(service.id) ? "bg-emerald-50 text-emerald-950" : "hover:bg-slate-50 text-slate-700"}`}
                          >
                            <span className="min-w-0">
                              <span className="block font-semibold line-clamp-1">{service.name}</span>
                              <span className="block text-xs text-slate-500 line-clamp-1">{service.category || "Transport"}</span>
                            </span>
                            <span className="shrink-0 text-[10px] font-semibold text-sky-700">Fare on confirm</span>
                          </button>
                        )) : transportService ? (
                          <p className="px-3 py-2 text-sm text-emerald-700">Selected service loaded. Clear search to browse other transport templates.</p>
                        ) : (
                          <p className="px-3 py-2 text-sm text-slate-500">No transport service found for this search.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {transportService ? (
                    <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] uppercase tracking-widest text-sky-700 font-semibold">Selected Service Template</p>
                          <p className="font-display font-bold text-emerald-950 mt-1">{transportService?.name}</p>
                          <p className="text-xs text-slate-600 mt-1">{transportService?.category || "Transport"} · Fare will be confirmed by partner</p>
                        </div>
                        <span className="rounded-full bg-white border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-800">Partner will review and confirm</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/60 px-4 py-5 text-sm text-slate-600">
                      আগে transport service template select করুন, তারপর pickup/destination fill করুন।
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input value={transportForm.customer_name} onChange={(e) => setTransportForm((prev) => ({ ...prev, customer_name: e.target.value }))} placeholder="Customer name" className="h-10" />
                    <Input value={transportForm.customer_phone} onChange={(e) => setTransportForm((prev) => ({ ...prev, customer_phone: e.target.value }))} placeholder="Mobile number" className="h-10" />
                  </div>
                  <Input value={guestMemberRef} onChange={(e) => setGuestMemberRef(e.target.value)} placeholder="Member ID/Code (optional for reward %)" className="h-10" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input value={transportForm.pickup} onChange={(e) => setTransportForm((prev) => ({ ...prev, pickup: e.target.value }))} placeholder="Pickup point" className="h-10" />
                    <Input
                      value={transportForm.destination}
                      onChange={(e) => {
                        setTransportForm((prev) => ({ ...prev, destination: e.target.value }));
                      }}
                      placeholder="Destination"
                      className="h-10"
                    />
                  </div>
                  <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                    <p className="text-[11px] font-semibold text-sky-900">Estimated fare (not final)</p>
                    <p className="text-xs text-slate-700 mt-1">{transportEstimateSummary.label}</p>
                    <p className="text-[11px] text-slate-600 mt-1">{transportEstimateSummary.detail} This is not the final fare. The final amount can be confirmed after discussing and agreeing with the business owner.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => {
                        const url = routeMapsUrl(transportForm.pickup, transportForm.destination);
                        if (!url) {
                          toast.error("Pickup বা destination দিন");
                          return;
                        }
                        window.open(url, "_blank", "noopener,noreferrer");
                      }}
                    >
                      Open Route in Google Maps
                    </Button>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-600 mb-1">Travel date and time</p>
                    <Input type="datetime-local" value={transportForm.travel_date} onChange={(e) => setTransportForm((prev) => ({ ...prev, travel_date: e.target.value }))} className="h-10" />
                  </div>
                  <Input value={transportForm.notes} onChange={(e) => setTransportForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notes (optional)" className="h-10" />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" onClick={submitTransportBooking} disabled={transportBusy || !(transportService?.id || filteredTransportServiceOptions[0]?.id || transportListings[0]?.id)}>
                      {transportBusy ? "Booking..." : "Submit Booking Request"}
                    </Button>
                    <Button variant="outline" className="rounded-full" onClick={() => setTransportActiveTab("services")}>View Services</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs text-emerald-900 font-semibold">Booking ID: {transportBooking.trip_code || transportBooking.id}</p>
                    <p className="text-xs text-slate-700 mt-1">Status: <span className="font-semibold uppercase">{transportBooking.status}</span></p>
                    {transportBooking?.service_name ? <p className="text-xs text-slate-700">Service: {transportBooking.service_name}</p> : null}
                    {transportBooking?.travel_date ? <p className="text-xs text-slate-700">Schedule: {formatTransportSchedule(transportBooking.travel_date)}</p> : null}
                    <p className="text-xs text-slate-700">Quoted Fare: ₹{Number(transportBooking.fare_quote || 0).toLocaleString("en-IN")}</p>
                    <p className="text-xs text-slate-700">Final Fare: {Number(transportBooking.fare_final || 0) > 0 ? `₹${transportBooking.fare_final}` : "Partner will set after review"}</p>
                    <p className="text-xs text-slate-700">Route: {transportBooking.pickup}{" -> "}{transportBooking.destination}</p>
                    {transportBooking?.response_note ? <p className="text-xs text-slate-700">Partner Note: {transportBooking.response_note}</p> : null}
                    <button
                      type="button"
                      className="text-xs text-emerald-800 underline mt-1"
                      onClick={() => {
                        const url = routeMapsUrl(transportBooking.pickup, transportBooking.destination);
                        if (url) window.open(url, "_blank", "noopener,noreferrer");
                      }}
                    >
                      View route on Google Maps
                    </button>
                  </div>
                  <p className="text-xs text-slate-600">Booking request partner queue-তে গেছে। Partner fare final করে accept/reject করবে; accept হলে trip execution flow এগোবে।</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="rounded-full" onClick={refreshTransportBooking}>Refresh Status</Button>
                    <Button className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" onClick={() => setTransportActiveTab("services")}>Done</Button>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          <section className="bg-white rounded-xl border border-sky-200 p-6 mb-8" data-testid="partner-shop-all-transport-box">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-sky-700 font-semibold">Transport Services</p>
                <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">Transport ({filteredTransport.length})</h3>
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="flex items-center gap-2 border border-sky-200 rounded-full px-3 h-11 bg-sky-50 w-full md:w-72">
                  <Search className="w-4 h-4 text-slate-500" />
                  <input
                    value={transportSearch}
                    onChange={(e) => setTransportSearch(e.target.value)}
                    placeholder="Search transport service"
                    className="bg-transparent outline-none text-sm w-full"
                    data-testid="partner-shop-inline-transport-search"
                  />
                </div>
              </div>
            </div>

            {filteredTransport.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-sky-200 p-10 text-center text-slate-500">
                No transport service found for this search.
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredTransport.map((service) => {
                  const pdfUrl = getPdfUrl(service);
                  return (
                    <div key={service.id} className="border border-sky-200 rounded-xl overflow-hidden bg-white" data-testid={`shop-transport-${service.id}`}>
                      <div className="aspect-square bg-slate-100 relative">
                        <button
                          type="button"
                          onClick={() => setPreviewItem(service)}
                          className="block w-full h-full"
                          data-testid={`shop-open-transport-image-${service.id}`}
                        >
                          <img
                            src={getDisplayImage(service, placeholder)}
                            alt={service.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              applyImageFallback(
                                e,
                                getProductImageUrl(service) || service?.fallback_image_url || featuredImages[0] || heroBannerSrc || "",
                                placeholder || ""
                              );
                            }}
                          />
                        </button>
                        <span className="absolute top-2 right-2 rounded-full bg-sky-600 text-white text-[10px] font-bold px-2.5 py-1">Transport</span>
                        {canAccessProductPdf && pdfUrl ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(pdfUrl, "_blank");
                            }}
                            className="absolute top-2 left-2 rounded-full bg-white/90 text-emerald-900 text-[10px] font-bold px-2.5 py-1"
                            data-testid={`shop-open-transport-pdf-${service.id}`}
                          >
                            <FileText className="w-3 h-3 inline mr-1" /> PDF
                          </button>
                        ) : null}
                      </div>
                      <div className="p-3">
                        <p className="text-[10px] uppercase tracking-widest text-sky-700 font-semibold truncate">{service.category}</p>
                        <p className="font-display font-bold text-emerald-950 mt-0.5 line-clamp-1">{service.name}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="font-display font-black text-emerald-950">₹{service.price}</span>
                          <span className="text-[11px] text-slate-500">Ride / Rental</span>
                        </div>

                        <Button
                          type="button"
                          onClick={() => bookServiceNow(service)}
                          className="w-full mt-3 rounded-full bg-sky-700 hover:bg-sky-800 text-white"
                          data-testid={`shop-book-transport-${service.id}`}
                        >
                          <CalendarCheck2 className="w-4 h-4 mr-2" /> Book Now
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}

      {canShowHospitality && hasHospitalityListings ? (
        <>
          <div className="mb-8">
            <div className="bg-white rounded-xl border border-amber-200 p-6" data-testid="partner-shop-hospitality-panel">
              <div className="flex items-start gap-2 mb-1">
                <p className="text-[10px] uppercase tracking-widest text-amber-700 font-semibold">Stay & Dining</p>
              </div>
              <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">Hotel, homestay, restaurant services</h3>
              <p className="text-sm text-slate-600 mt-3">Room stay, table booking, banquet, cafe and dining services এক জায়গায় দেখুন।</p>
              <div className="mt-6 flex flex-col lg:flex-row gap-3 lg:items-center">
                <Button onClick={() => openGallery(hospitalitySearch, "stay-dining")} className="w-full lg:w-auto lg:min-w-[220px] bg-amber-600 hover:bg-amber-700 text-white rounded-full" data-testid="partner-stay-gallery-btn">
                  <CalendarCheck2 className="w-4 h-4 mr-2" /> View Stay & Dining
                </Button>
                <div className="flex flex-1 gap-2" data-testid="partner-shop-hospitality-search-panel">
                  <Input
                    value={hospitalitySearch}
                    onChange={(e) => setHospitalitySearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    placeholder="Search hotel, homestay, restaurant, cafe"
                    className="h-11 rounded-full text-sm"
                    data-testid="partner-shop-hospitality-search"
                  />
                  <Button
                    onClick={() => openGallery(hospitalitySearch, "stay-dining")}
                    className="bg-amber-600 hover:bg-amber-700 text-white rounded-full shrink-0"
                    data-testid="partner-shop-hospitality-search-btn"
                  >
                    Search
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <section className="bg-white rounded-xl border border-amber-200 p-6 mb-8" data-testid="partner-shop-hospitality-box">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-amber-700 font-semibold">Stay & Dining</p>
                <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">Stay & Dining ({filteredHospitality.length})</h3>
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <Button variant="outline" className="rounded-full shrink-0 border-amber-300 text-amber-900" onClick={() => openGallery(hospitalitySearch, "stay-dining")} data-testid="partner-shop-hospitality-view-all-link">
                  View Stay & Dining
                </Button>
                <div className="flex items-center gap-2 border border-amber-200 rounded-full px-3 h-11 bg-amber-50 w-full md:w-72">
                  <Search className="w-4 h-4 text-slate-500" />
                  <input
                    value={hospitalitySearch}
                    onChange={(e) => setHospitalitySearch(e.target.value)}
                    placeholder="Search stay or dining"
                    className="bg-transparent outline-none text-sm w-full"
                    data-testid="partner-shop-inline-hospitality-search"
                  />
                </div>
              </div>
            </div>

            {filteredHospitality.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-amber-200 p-10 text-center text-slate-500">
                No stay/dining service found for this search.
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredHospitality.map((service) => {
                  const pdfUrl = getPdfUrl(service);
                  return (
                    <div key={service.id} className="border border-amber-200 rounded-xl overflow-hidden bg-white" data-testid={`shop-hospitality-${service.id}`}>
                      <div className="aspect-square bg-slate-100 relative">
                        <button type="button" onClick={() => setPreviewItem(service)} className="block w-full h-full" data-testid={`shop-open-hospitality-image-${service.id}`}>
                          <img
                            src={getDisplayImage(service, placeholder)}
                            alt={service.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              applyImageFallback(
                                e,
                                getProductImageUrl(service) || service?.fallback_image_url || featuredImages[0] || heroBannerSrc || "",
                                placeholder || ""
                              );
                            }}
                          />
                        </button>
                        {canAccessProductPdf && pdfUrl ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); window.open(pdfUrl, "_blank"); }} className="absolute top-2 left-2 rounded-full bg-white/90 text-emerald-900 text-[10px] font-bold px-2.5 py-1" data-testid={`shop-open-hospitality-pdf-${service.id}`}>
                            <FileText className="w-3 h-3 inline mr-1" /> PDF
                          </button>
                        ) : null}
                      </div>
                      <div className="p-3">
                        <p className="text-[10px] uppercase tracking-widest text-amber-700 font-semibold truncate">{service.category}</p>
                        <p className="font-display font-bold text-emerald-950 mt-0.5 line-clamp-1">{service.name}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="font-display font-black text-emerald-950">₹{service.price}</span>
                          <span className="text-[11px] text-slate-500">Stay / Dining</span>
                        </div>
                        <Button type="button" onClick={() => bookServiceNow(service)} className="w-full mt-3 rounded-full bg-amber-600 hover:bg-amber-700 text-white" data-testid={`shop-book-hospitality-${service.id}`}>
                          <CalendarCheck2 className="w-4 h-4 mr-2" /> Book Now
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}

      {canShowDoorstep && hasDoorstepListings ? (
        <>
          <div className="mb-8">
            <div className="bg-white rounded-xl border border-violet-200 p-6" data-testid="partner-shop-doorstep-panel">
              <div className="flex items-start gap-2 mb-1">
                <p className="text-[10px] uppercase tracking-widest text-violet-700 font-semibold">Doorstep Services</p>
              </div>
              <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">Home visit and doorstep services</h3>
              <p className="text-sm text-slate-600 mt-3">Cleaning, repair, laundry, courier, beauty-at-home এর মতো services এখানেই পাবেন।</p>
              <div className="mt-6 flex flex-col lg:flex-row gap-3 lg:items-center">
                <Button onClick={() => openGallery(doorstepSearch, "doorstep")} className="w-full lg:w-auto lg:min-w-[220px] bg-violet-700 hover:bg-violet-800 text-white rounded-full" data-testid="partner-doorstep-gallery-btn">
                  <CalendarCheck2 className="w-4 h-4 mr-2" /> View Doorstep Services
                </Button>
                <div className="flex flex-1 gap-2" data-testid="partner-shop-doorstep-search-panel">
                  <Input
                    value={doorstepSearch}
                    onChange={(e) => setDoorstepSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    placeholder="Search cleaning, repair, laundry, courier"
                    className="h-11 rounded-full text-sm"
                    data-testid="partner-shop-doorstep-search"
                  />
                  <Button
                    onClick={() => openGallery(doorstepSearch, "doorstep")}
                    className="bg-violet-700 hover:bg-violet-800 text-white rounded-full shrink-0"
                    data-testid="partner-shop-doorstep-search-btn"
                  >
                    Search
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <section className="bg-white rounded-xl border border-violet-200 p-6 mb-8" data-testid="partner-shop-doorstep-box">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-violet-700 font-semibold">Doorstep Services</p>
                <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">Doorstep ({filteredDoorstep.length})</h3>
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <Button variant="outline" className="rounded-full shrink-0 border-violet-300 text-violet-900" onClick={() => openGallery(doorstepSearch, "doorstep")} data-testid="partner-shop-doorstep-view-all-link">
                  View Doorstep Services
                </Button>
                <div className="flex items-center gap-2 border border-violet-200 rounded-full px-3 h-11 bg-violet-50 w-full md:w-72">
                  <Search className="w-4 h-4 text-slate-500" />
                  <input
                    value={doorstepSearch}
                    onChange={(e) => setDoorstepSearch(e.target.value)}
                    placeholder="Search doorstep service"
                    className="bg-transparent outline-none text-sm w-full"
                    data-testid="partner-shop-inline-doorstep-search"
                  />
                </div>
              </div>
            </div>

            {filteredDoorstep.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-violet-200 p-10 text-center text-slate-500">
                No doorstep service found for this search.
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredDoorstep.map((service) => {
                  const pdfUrl = getPdfUrl(service);
                  return (
                    <div key={service.id} className="border border-violet-200 rounded-xl overflow-hidden bg-white" data-testid={`shop-doorstep-${service.id}`}>
                      <div className="aspect-square bg-slate-100 relative">
                        <button type="button" onClick={() => setPreviewItem(service)} className="block w-full h-full" data-testid={`shop-open-doorstep-image-${service.id}`}>
                          <img
                            src={getDisplayImage(service, placeholder)}
                            alt={service.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              applyImageFallback(
                                e,
                                getProductImageUrl(service) || service?.fallback_image_url || featuredImages[0] || heroBannerSrc || "",
                                placeholder || ""
                              );
                            }}
                          />
                        </button>
                        {canAccessProductPdf && pdfUrl ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); window.open(pdfUrl, "_blank"); }} className="absolute top-2 left-2 rounded-full bg-white/90 text-emerald-900 text-[10px] font-bold px-2.5 py-1" data-testid={`shop-open-doorstep-pdf-${service.id}`}>
                            <FileText className="w-3 h-3 inline mr-1" /> PDF
                          </button>
                        ) : null}
                      </div>
                      <div className="p-3">
                        <p className="text-[10px] uppercase tracking-widest text-violet-700 font-semibold truncate">{service.category}</p>
                        <p className="font-display font-bold text-emerald-950 mt-0.5 line-clamp-1">{service.name}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="font-display font-black text-emerald-950">₹{service.price}</span>
                          <span className="text-[11px] text-slate-500">Doorstep</span>
                        </div>
                        <Button type="button" onClick={() => bookServiceNow(service)} className="w-full mt-3 rounded-full bg-violet-700 hover:bg-violet-800 text-white" data-testid={`shop-book-doorstep-${service.id}`}>
                          <CalendarCheck2 className="w-4 h-4 mr-2" /> Book Now
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}

      {canShowOtherServices && hasServiceListings ? (
        <>
          <div className="mb-8">
            <div className="bg-white rounded-xl border border-border p-6" data-testid="partner-shop-left-services-panel">
              <div className="flex items-start gap-2 mb-1">
                <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Other Services</p>
              </div>
              <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">View all other services</h3>
              <p className="text-sm text-slate-600 mt-3">Clinic, education, fitness, legal, photography, travel and other remaining services এখানে পাবেন।</p>
              <div className="mt-6 flex flex-col lg:flex-row gap-3 lg:items-center">
                <Button onClick={() => openGallery(serviceSearch, "other-services")} className="w-full lg:w-auto lg:min-w-[220px] bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="partner-services-gallery-btn">
                  <CalendarCheck2 className="w-4 h-4 mr-2" /> View Other Services
                </Button>
                <div className="flex flex-1 gap-2" data-testid="partner-shop-right-service-search-panel">
                  <Input
                    value={serviceSearch}
                    onChange={(e) => setServiceSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    placeholder="Search clinic, fitness, legal, travel"
                    className="h-11 rounded-full text-sm"
                    data-testid="partner-shop-service-search"
                  />
                  <Button
                    onClick={() => openGallery(serviceSearch, "other-services")}
                    className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full shrink-0"
                    data-testid="partner-shop-service-search-btn"
                  >
                    Search
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <section className="bg-white rounded-xl border border-border p-6 mb-8" data-testid="partner-shop-all-services-box">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Other Services</p>
                <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">Other Services ({filteredServices.length})</h3>
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <Button variant="outline" className="rounded-full shrink-0" onClick={() => openGallery(serviceSearch, "other-services")} data-testid="partner-shop-services-view-all-link">
                  View Other Services
                </Button>
                <div className="flex items-center gap-2 border border-border rounded-full px-3 h-11 bg-slate-50 w-full md:w-72">
                  <Search className="w-4 h-4 text-slate-500" />
                  <input
                    value={serviceSearch}
                    onChange={(e) => setServiceSearch(e.target.value)}
                    placeholder="Search other services"
                    className="bg-transparent outline-none text-sm w-full"
                    data-testid="partner-shop-inline-service-search"
                  />
                </div>
              </div>
            </div>

            {filteredServices.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center text-slate-500">
                No service found for this search.
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredServices.map((service) => {
                  const pdfUrl = getPdfUrl(service);
                  return (
                    <div key={service.id} className="border border-border rounded-xl overflow-hidden bg-white" data-testid={`shop-service-${service.id}`}>
                      <div className="aspect-square bg-slate-100 relative">
                        <button
                          type="button"
                          onClick={() => setPreviewItem(service)}
                          className="block w-full h-full"
                          data-testid={`shop-open-service-image-${service.id}`}
                        >
                          <img
                            src={getDisplayImage(service, placeholder)}
                            alt={service.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              applyImageFallback(
                                e,
                                getProductImageUrl(service) || service?.fallback_image_url || featuredImages[0] || heroBannerSrc || "",
                                placeholder || ""
                              );
                            }}
                          />
                        </button>
                        {canAccessProductPdf && pdfUrl ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(pdfUrl, "_blank");
                            }}
                            className="absolute top-2 left-2 rounded-full bg-white/90 text-emerald-900 text-[10px] font-bold px-2.5 py-1"
                            data-testid={`shop-open-service-pdf-${service.id}`}
                          >
                            <FileText className="w-3 h-3 inline mr-1" /> PDF
                          </button>
                        ) : null}
                      </div>
                      <div className="p-3">
                        <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold truncate">{service.category}</p>
                        <p className="font-display font-bold text-emerald-950 mt-0.5 line-clamp-1">{service.name}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="font-display font-black text-emerald-950">₹{service.price}</span>
                          <span className="text-[11px] text-slate-500">Service</span>
                        </div>

                        <Button
                          type="button"
                          onClick={() => bookServiceNow(service)}
                          className="w-full mt-3 rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
                          data-testid={`shop-book-service-${service.id}`}
                        >
                          <CalendarCheck2 className="w-4 h-4 mr-2" /> Book Now
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}

      {previewItem ? (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={closePreview}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="aspect-square overflow-hidden bg-slate-100 relative">
              <img
                src={getDisplayImage(previewItem, placeholder)}
                alt={previewItem?.name || "Product image"}
                className="w-full h-full object-cover"
                onError={(e) => {
                  applyImageFallback(
                    e,
                    getProductImageUrl(previewItem) || previewItem?.fallback_image_url || featuredImages[0] || heroBannerSrc || "",
                    placeholder || ""
                  );
                }}
              />
              <button onClick={closePreview} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">{previewItem?.category || "General"}</p>
              <h3 className="font-display font-black text-emerald-950 text-xl mt-1">{previewItem?.name || "Product"}</h3>
              {previewItem?.description ? <p className="text-sm text-slate-600 mt-2">{previewItem.description}</p> : <p className="text-sm text-slate-500 mt-2">No description provided.</p>}
              <div className="mt-3 flex items-center justify-between">
                <span className="font-display font-black text-3xl text-emerald-950">₹{previewItem?.price || 0}</span>
                <span className="text-sm text-slate-500">{isServiceListing(previewItem) ? "Service" : `Stock: ${getStock(previewItem)}`}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <UpiPaymentDialog
        open={open}
        onOpenChange={setOpen}
        items={items}
        total={total}
        paymentConfig={paymentProfile ? {
          upi_id: paymentProfile.upi_id,
          payee_name: paymentProfile.payee_name,
          qr_url: paymentProfile.qr_url,
          cod_enabled: paymentProfile.cod_enabled !== false,
          manual_upi_enabled: paymentProfile.manual_upi_enabled !== false,
          razorpay_enabled: false,
          label: "Partner UPI Payment",
        } : null}
        isGuest={!user}
        memberRef={guestMemberRef}
        onMemberRefChange={setGuestMemberRef}
        onOrderPlaced={() => {
          setGuestMemberRef("");
          setCart({});
          setOpen(false);
          toast.success("Order placed successfully");
          if (user) setTimeout(() => nav("/app/orders"), 400);
        }}
      />
    </div>
  );
}


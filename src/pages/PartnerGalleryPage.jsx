import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, ShoppingCart, Plus, Minus, Share2, FileDown,
  MessageCircle, X, Phone, MapPin, Store, Star, Search, CalendarCheck2, PlayCircle,
} from "lucide-react";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import UpiPaymentDialog from "@/components/UpiPaymentDialog";
import { useAuth } from "@/contexts/AuthContext";
import { resolveAssetUrl, getAssetImageFallbackCandidates, openWhatsAppShare } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { inferPartnerPrimarySector, getPartnerVisibleSectors, isDeliveryServiceLike, isDoorstepServiceLike, isHospitalityServiceLike, isPropertyServiceLike, isTransportServiceLike, PARTNER_SECTOR_KEYS } from "@/lib/partnerSector";

const FALLBACK = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23e2e8f0'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23475569' font-size='20' font-family='Arial'>No Image</text></svg>";
const PDF_PREVIEW = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23f1f5f9'/><rect x='80' y='50' width='240' height='300' rx='14' fill='%23ffffff' stroke='%2394a3b8' stroke-width='4'/><text x='200' y='190' text-anchor='middle' fill='%23dc2626' font-size='46' font-family='Arial' font-weight='bold'>PDF</text><text x='200' y='228' text-anchor='middle' fill='%23334155' font-size='16' font-family='Arial'>Tap to Open</text></svg>";
const normalizeYoutubeUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(www\.)?youtube\.com\//i.test(raw) || /^youtu\.be\//i.test(raw)) return `https://${raw}`;
  return "";
};
const normalizeFacebookUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(www\.)?facebook\.com\//i.test(raw) || /^fb\.com\//i.test(raw)) return `https://${raw}`;
  return "";
};
const cleanPhone = (v) => (v || "").replace(/[^\d]/g, "");
const ownerChatUrl = (partner) => {
  const n = cleanPhone(partner?.whatsapp_no || partner?.phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(`Hi ${partner?.business_name || "Owner"}, I found your shop on METHOO STORE`)}` : "";
};
const liveLocationUrl = (location) => {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
};
const bookingWhatsAppUrl = (booking) => {
  const number = cleanPhone(booking?.driver?.whatsapp || booking?.driver?.phone || booking?.partner_whatsapp || booking?.partner_phone);
  if (!number) return "";
  const message = `Hello ${booking?.partner_name || "Partner"}, I am contacting you about delivery ${booking?.trip_code || booking?.id || ""}.`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
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

const isPdfUrl = (value) => /\.pdf($|\?)/i.test(String(value || ""));

const getDisplayImage = (product) => {
  if (product?.image_url && !isPdfUrl(product.image_url)) return resolveAssetUrl(product.image_url);
  if (product?.fallback_image_url) return resolveAssetUrl(product.fallback_image_url);
  if (getPdfUrl(product)) return FALLBACK;
  return FALLBACK;
};

const applyImageFallback = (event, fallbackUrl) => {
  const target = event.currentTarget;
  const candidates = getAssetImageFallbackCandidates(target.src, [fallbackUrl, FALLBACK]);
  const tried = Number(target.dataset.fallbackIndex || "0");
  for (let i = tried; i < candidates.length; i += 1) {
    const next = String(candidates[i] || "").trim();
    if (!next || next === target.src) continue;
    target.dataset.fallbackIndex = String(i + 1);
    target.src = next;
    return;
  }
  if (target.src !== FALLBACK) target.src = FALLBACK;
};

const pickImageUrl = (value) => {
  if (!value) return "";
  if (typeof value === "string") return isLikelyAssetRef(value) ? resolveAssetUrl(value) : "";
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
    const direct = ordered.map((u) => pickImageUrl(u));
    if (direct.some(Boolean)) return direct.slice(0, 5);
    return ["", "", "", "", ""];
  }
  return ["", "", "", "", ""];
};

const normalizePartnerPayload = (payload) => {
  const partner = payload?.partner || {};
  const featuredImages = normalizeFeaturedImages(payload?.featured_images || payload?.partner?.featured_images);
  const partnerBanner = firstValidAssetRef(partner?.banner_url, partner?.shop_banner_url, partner?.banner, partner?.cover_url);
  const partnerLogo = firstValidAssetRef(partner?.logo_url, partner?.logo, partner?.shop_logo_url);
  const fallbackPool = [...featuredImages, partnerBanner, partnerLogo].filter(Boolean);
  const products = Array.isArray(payload?.products)
    ? payload.products.map((item, index) => {
      const resolvedImage = firstValidAssetRef(
        item?.image_url,
        item?.product_image_url,
        item?.image,
        item?.thumbnail_url,
        item?.thumb_url,
        item?.cover_url,
        item?.photo_url
      );
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
      logo_url: resolveAssetUrl(partner?.logo_url || ""),
      banner_url: resolveAssetUrl(partner?.banner_url || ""),
    },
    products,
    featured_images: { items: featuredImages },
  };
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

const getDeliveryRatePerKm = (service) => {
  const candidates = [
    service?.delivery_rate_per_km,
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

const estimateDeliveryFareFromRoute = async (pickup, destination, service) => {
  const origin = String(pickup || "").trim();
  const dest = String(destination || "").trim();
  if (!origin || !dest) return null;
  try {
    const [originCoords, destCoords] = await Promise.all([geocodeAddress(origin), geocodeAddress(dest)]);
    if (!originCoords || !destCoords) return null;
    const routeResponse = await fetch(`https://router.project-osrm.org/route/v1/driving/${originCoords.lon},${originCoords.lat};${destCoords.lon},${destCoords.lat}?overview=false&alternatives=true`);
    const routeData = routeResponse.ok ? await routeResponse.json() : null;
    const routeDistances = Array.isArray(routeData?.routes)
      ? routeData.routes.map((route) => Number(route.distance || 0) / 1000).filter((distance) => Number.isFinite(distance) && distance > 0)
      : [];
    const distanceKm = routeDistances.length ? Math.max(...routeDistances) : haversineKm(originCoords.lat, originCoords.lon, destCoords.lat, destCoords.lon);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
    const ratePerKm = getDeliveryRatePerKm(service);
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
const isPropertyServiceListing = (item) => {
  return isPropertyServiceLike(item);
};

const getUnitType = (item) => {
  const unit = String(item?.unit_type || "").trim().toLowerCase();
  if (["kg", "gram", "litre", "ml", "piece"].includes(unit)) return unit;

  // Fallback: treat grocery/produce-like listings as weighted products when unit metadata is missing.
  const haystack = [item?.category, item?.name, item?.description]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  const looksWeighted = [
    "vegetable", "vegetabel", "veg", "sabji", "grocery", "fruit", "fish", "meat", "rice", "dal", "atta", "oil", "spice",
  ].some((k) => haystack.includes(k));
  if (looksWeighted) return "kg";

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
  const resolvedMeasureUnit = resolveMeasureUnit(item, measureUnit);
  if (unit === "piece") {
    const configured = Number(item?.quantity_step || 0);
    return Number.isFinite(configured) && configured > 0 ? Math.max(1, Math.round(configured)) : 1;
  }
  return Number(convertQtyBetweenUnits(getMeasureUnitStep(resolvedMeasureUnit), resolvedMeasureUnit, unit).toFixed(3));
};

const normalizeQtyByUnit = (value, item, measureUnit = "") => {
  const step = getQtyStep(item, measureUnit);
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

const formatQtyWithUnit = (qty, item) => {
  const unit = getUnitType(item);
  const value = formatQty(qty);
  if (unit === "piece") return value;
  return `${value} ${unit}`;
};

const getSelectableMeasureUnits = (item) => {
  const unit = getUnitType(item);
  if (unit === "kg") return ["kg", "gram"];
  if (unit === "gram") return ["gram", "kg"];
  if (unit === "litre") return ["litre", "ml"];
  if (unit === "ml") return ["ml", "litre"];
  return [unit];
};

const convertQtyBetweenUnits = (qty, fromUnit, toUnit) => {
  const amount = Number(qty || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (fromUnit === toUnit) return amount;
  if (fromUnit === "kg" && toUnit === "gram") return amount * 1000;
  if (fromUnit === "gram" && toUnit === "kg") return amount / 1000;
  if (fromUnit === "litre" && toUnit === "ml") return amount * 1000;
  if (fromUnit === "ml" && toUnit === "litre") return amount / 1000;
  return amount;
};

const resolveMeasureUnit = (item, preferredUnit = "") => {
  const options = getSelectableMeasureUnits(item);
  return options.includes(preferredUnit) ? preferredUnit : options[0];
};

const formatQtyForMeasureUnit = (qty, item, measureUnit = "") => {
  const baseUnit = getUnitType(item);
  const unit = resolveMeasureUnit(item, measureUnit);
  const converted = convertQtyBetweenUnits(qty, baseUnit, unit);
  const value = formatQty(converted);
  if (unit === "piece") return value;
  return `${value} ${unit}`;
};

const formatPriceForMeasureUnit = (price, item, measureUnit = "") => {
  const amount = Number(price || 0);
  const baseUnit = getUnitType(item);
  const unit = resolveMeasureUnit(item, measureUnit);
  if (baseUnit === unit || unit === "piece") return `₹${amount} / ${unit}`;
  let convertedPrice = amount;
  if (baseUnit === "kg" && unit === "gram") convertedPrice = amount / 1000;
  else if (baseUnit === "gram" && unit === "kg") convertedPrice = amount * 1000;
  else if (baseUnit === "litre" && unit === "ml") convertedPrice = amount / 1000;
  else if (baseUnit === "ml" && unit === "litre") convertedPrice = amount * 1000;
  return `₹${Number(convertedPrice.toFixed(2))} / ${unit}`;
};

const subtotalForQuantity = (qty, item) => Number(((Number(item?.price || 0) * Number(qty || 0))).toFixed(2));

function ProductModal({ product, onClose, onAdd, onDec, qty, galleryUrl, isBookNowRole, onBookNow, canAccessProductPdf, onCheckout, measureUnit, onMeasureUnitChange }) {
  if (!product) return null;
  const productUrl = `${galleryUrl}?p=${product.id}`;
  const pdfUrl = getPdfUrl(product);
  const isService = isServiceListing(product);
  const selectableUnits = getSelectableMeasureUnits(product);
  const activeMeasureUnit = resolveMeasureUnit(product, measureUnit);
  const subtotal = subtotalForQuantity(qty, product);
  // WhatsApp message: include image URL so WA shows image preview
  const mediaLine = product.image_url || pdfUrl;
  const waMsg = mediaLine
    ? `${mediaLine}\n\n🛍️ *${product.name}*\n💰 ₹${product.price}  |  ${product.category || ""}\n\n👉 এখানে দেখুন ও Order করুন:\n${productUrl}`
    : `🛍️ *${product.name}*\n💰 ₹${product.price}  |  ${product.category || ""}\n\n👉 এখানে দেখুন ও Order করুন:\n${productUrl}`;
  const canDownloadPdf = !!pdfUrl && !!canAccessProductPdf;
  const openPdfPreview = (url) => {
    if (!url) return;
    const withViewerFlags = `${url}${url.includes("#") ? "&" : "#"}toolbar=0&navpanes=0&scrollbar=1`;
    window.open(withViewerFlags, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="aspect-square overflow-hidden bg-slate-100 relative">
          <img
            src={getDisplayImage(product)}
            alt={product.name}
            className="w-full h-full object-cover"
            onError={e => { applyImageFallback(e, product?.fallback_image_url || ""); }}
          />
          {canDownloadPdf && pdfUrl ? (
            <button
              type="button"
              onClick={() => openPdfPreview(pdfUrl)}
              className="absolute left-3 top-3 rounded-full bg-white/90 text-emerald-900 px-3 py-1 text-[10px] font-bold"
            >
              View PDF
            </button>
          ) : null}
          <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60">
            <X className="w-4 h-4" />
          </button>
          {product.stock <= 0 && !isService && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <span className="text-white font-black text-xl">Out of Stock</span>
            </div>
          )}
        </div>
        <div className="p-5">
          <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">{product.category}</p>
          <h3 className="font-display font-black text-emerald-950 text-xl mt-1">{product.name}</h3>
          {product.description && <p className="text-sm text-slate-600 mt-2 font-body">{product.description}</p>}
          <div className="mt-3 flex items-center justify-between">
            <div>
              <span className="font-display font-black text-3xl text-emerald-950">₹{product.price}</span>
              {!isService ? <p className="text-xs text-slate-500 mt-1">{formatPriceForMeasureUnit(product.price, product, activeMeasureUnit)}</p> : null}
            </div>
            {isService ? <span className="text-sm text-slate-500">Service</span> : ((Number(product.stock ?? 0) <= 0) ? <span className="text-sm text-slate-500">Out of Stock</span> : null)}
          </div>
          <div className="mt-4 space-y-2">
            {!isService && selectableUnits.length > 1 ? (
              <select
                value={activeMeasureUnit}
                onChange={(e) => onMeasureUnitChange?.(product.id, e.target.value)}
                className="h-10 w-full rounded-full border border-input bg-white px-4 text-sm"
              >
                {selectableUnits.map((unit) => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            ) : null}
            {product.stock <= 0 && !isService ? (
              <Button disabled className="w-full rounded-full">Unavailable</Button>
            ) : isService && isBookNowRole ? (
              <Button onClick={() => onBookNow(product)} className="w-full bg-emerald-900 hover:bg-emerald-950 text-white rounded-full text-base h-12">
                <CalendarCheck2 className="w-4 h-4 mr-2" /> Book Now
              </Button>
            ) : qty > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between bg-emerald-50 rounded-full px-3 py-2">
                  <button onClick={() => onDec(product.id)} className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:bg-emerald-100">
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="font-black text-emerald-950 text-lg">{formatQtyForMeasureUnit(qty, product, activeMeasureUnit)}</span>
                  <button onClick={() => onAdd(product.id)} className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:bg-emerald-100">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm font-semibold text-emerald-900 text-center">Subtotal: ₹{subtotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
                <Button onClick={() => onCheckout?.()} className="w-full bg-amber-500 hover:bg-amber-600 text-emerald-950 rounded-full text-base h-11 font-bold">
                  <ShoppingCart className="w-4 h-4 mr-2" /> Checkout Now
                </Button>
              </div>
            ) : (
              <Button onClick={() => { onAdd(product.id); }} className="w-full bg-emerald-900 hover:bg-emerald-950 text-white rounded-full text-base h-12">
                {isService ? <CalendarCheck2 className="w-4 h-4 mr-2" /> : <ShoppingCart className="w-4 h-4 mr-2" />} {isService ? "Book Now" : "Add to Cart"}
              </Button>
            )}
            {/* Share this product on WhatsApp */}
            <button
              onClick={() => openWhatsAppShare({ text: waMsg })}
              className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white rounded-full py-2.5 text-sm font-bold"
            >
              <MessageCircle className="w-4 h-4" /> Share this product on WhatsApp
            </button>
            <button
              onClick={async () => { await navigator.clipboard.writeText(productUrl); }}
              className="w-full flex items-center justify-center gap-2 border border-slate-300 rounded-full py-2 text-xs text-slate-600 hover:bg-slate-50"
            >
              <Share2 className="w-3.5 h-3.5" /> Product Link Copy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PartnerGalleryPage() {
  const { partnerCode } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const autoPdfTriggered = useRef(false);
  const [data, setData] = useState(null);
  const [paymentProfile, setPaymentProfile] = useState(null);
  const [offerPopup, setOfferPopup] = useState(null);
  const [showOfferPopup, setShowOfferPopup] = useState(false);
  const [err, setErr] = useState(null);
  const [cart, setCart] = useState({});
  const [cartUnits, setCartUnits] = useState({});
  const [selected, setSelected] = useState(null); // product for modal
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [guestMemberRef, setGuestMemberRef] = useState("");
  const searchText = String(searchParams.get("q") || "").trim();
  const requestedTab = String(searchParams.get("tab") || "products").toLowerCase();
  const [gallerySearch, setGallerySearch] = useState(searchText);
  const [deliveryBookingService, setDeliveryBookingService] = useState(null);
  const [deliveryBookingOpen, setDeliveryBookingOpen] = useState(false);
  const [deliveryBookingBusy, setDeliveryBookingBusy] = useState(false);
  const [deliveryBooking, setDeliveryBooking] = useState(null);
  const [deliveryBookingForm, setDeliveryBookingForm] = useState({
    customer_name: "",
    customer_phone: "",
    receiver_name: "",
    receiver_phone: "",
    pickup: "",
    destination: "",
    travel_date: "",
    notes: "",
  });
  const [deliveryMemberLookupBusy, setDeliveryMemberLookupBusy] = useState(false);
  const [deliveryMemberLookupInfo, setDeliveryMemberLookupInfo] = useState(null);
  const [deliveryFareEstimate, setDeliveryFareEstimate] = useState(null);
  const [deliveryFareEstimateLoading, setDeliveryFareEstimateLoading] = useState(false);
  const deliveryEstimateRequestRef = useRef(0);

  useEffect(() => {
    setGallerySearch(searchText);
  }, [searchText]);

  useEffect(() => {
    api.get(`/directory/partner/${partnerCode}`)
      .then(r => setData(normalizePartnerPayload(r.data)))
      .catch(e => setErr(e?.response?.data?.detail || "Gallery not found"));
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

  // Auto-open product from URL param ?p=productId
  useEffect(() => {
    const pid = searchParams.get("p");
    if (pid && data?.products) {
      const product = data.products.find((p) => String(p.id) === String(pid));
      if (product) setSelected(product);
    }
  }, [searchParams, data]);

  const partner = data?.partner;
  const negotiateWithPartner = () => {
    const partnerPhone = cleanPhone(partner?.whatsapp_no || partner?.phone);
    if (!partnerPhone) {
      toast.error("Partner WhatsApp number is not available");
      return;
    }

    const fareText = deliveryFareEstimate?.amount
      ? `Estimated fare: ₹${Number(deliveryFareEstimate.amount).toLocaleString("en-IN")}`
      : "Fare to be confirmed";
    openWhatsAppShare({
      phone: partnerPhone,
      text: [
        `Hi ${partner?.business_name || "Partner"}, I want to negotiate this delivery booking.`,
        `Pickup: ${deliveryBookingForm.pickup || "Not provided"}`,
        `Destination: ${deliveryBookingForm.destination || "Not provided"}`,
        fareText,
        deliveryBookingForm.notes ? `Note: ${deliveryBookingForm.notes}` : "",
      ].filter(Boolean).join("\n"),
    });
  };
  const products = useMemo(() => data?.products || [], [data?.products]);
  const productListings = useMemo(() => products.filter((item) => !isServiceListing(item)), [products]);
  const serviceListings = useMemo(() => products.filter((item) => isServiceListing(item)), [products]);
  const deliveryListings = useMemo(() => serviceListings.filter((item) => isDeliveryServiceLike(item)), [serviceListings]);
  const transportListings = useMemo(() => serviceListings.filter((item) => !isDeliveryServiceLike(item) && isTransportServiceListing(item)), [serviceListings]);
  const hospitalityListings = useMemo(() => serviceListings.filter((item) => !isTransportServiceListing(item) && !isDeliveryServiceLike(item) && isHospitalityServiceListing(item)), [serviceListings]);
  const propertyListings = useMemo(() => serviceListings.filter((item) => !isTransportServiceListing(item) && !isDeliveryServiceLike(item) && !isHospitalityServiceListing(item) && isPropertyServiceListing(item)), [serviceListings]);
  const doorstepListings = useMemo(() => serviceListings.filter((item) => !isTransportServiceListing(item) && !isDeliveryServiceLike(item) && !isHospitalityServiceListing(item) && !isPropertyServiceListing(item) && isDoorstepServiceListing(item)), [serviceListings]);
  const regularServiceListings = useMemo(() => serviceListings.filter((item) => !isTransportServiceListing(item) && !isDeliveryServiceLike(item) && !isHospitalityServiceListing(item) && !isPropertyServiceListing(item) && !isDoorstepServiceListing(item)), [serviceListings]);
  const primarySector = useMemo(() => inferPartnerPrimarySector({
    businessType: partner?.business_type,
    businessName: partner?.business_name,
    counts: {
      products: productListings.length,
      transport: transportListings.length,
        delivery: deliveryListings.length,
      hospitality: hospitalityListings.length,
      property: propertyListings.length,
      doorstep: doorstepListings.length,
      otherServices: regularServiceListings.length,
    },
  }), [
    partner?.business_type,
    partner?.business_name,
    productListings.length,
    transportListings.length,
    deliveryListings.length,
    hospitalityListings.length,
    propertyListings.length,
    doorstepListings.length,
    regularServiceListings.length,
  ]);
  const visibleSectors = useMemo(() => getPartnerVisibleSectors(primarySector), [primarySector]);
  const allowedTabs = useMemo(() => {
    const tabs = [];
    if (visibleSectors.includes(PARTNER_SECTOR_KEYS.PRODUCT_SECTOR)) tabs.push("products");
    if (visibleSectors.includes(PARTNER_SECTOR_KEYS.TRANSPORT_SECTOR)) tabs.push("transport");
    if (visibleSectors.includes(PARTNER_SECTOR_KEYS.DELIVERY_PARTNER_SECTOR)) tabs.push("delivery-partner");
    if (visibleSectors.includes(PARTNER_SECTOR_KEYS.HOSPITALITY_SECTOR)) tabs.push("stay-dining");
    if (visibleSectors.includes(PARTNER_SECTOR_KEYS.PROPERTY_SECTOR)) tabs.push("property-buy-sell");
    if (visibleSectors.includes(PARTNER_SECTOR_KEYS.DOORSTEP_SECTOR)) tabs.push("doorstep");
    if (visibleSectors.includes(PARTNER_SECTOR_KEYS.OTHER_SERVICE_SECTOR)) tabs.push("other-services");
    return tabs.length ? tabs : ["products"];
  }, [visibleSectors]);
  const defaultTab = allowedTabs[0] || "products";
  const activeTab = allowedTabs.includes(requestedTab) ? requestedTab : defaultTab;
  const activeListings = activeTab === "transport"
    ? transportListings
    : (activeTab === "delivery-partner"
      ? deliveryListings
    : (activeTab === "stay-dining"
      ? hospitalityListings
      : (activeTab === "property-buy-sell"
        ? propertyListings
      : (activeTab === "doorstep"
        ? doorstepListings
        : (activeTab === "other-services" ? regularServiceListings : productListings)))));

  const tabLabelMap = {
    products: "Products",
    transport: "Transport",
    "delivery-partner": "Delivery",
    "stay-dining": "Stay & Dining",
    "property-buy-sell": "Property",
    doorstep: "Doorstep",
    "other-services": "Other Services",
  };
  const searchLabelMap = {
    products: "Search Product",
    transport: "Search Transport",
    "delivery-partner": "Search Delivery Service",
    "stay-dining": "Search Stay & Dining",
    "property-buy-sell": "Search Property Service",
    doorstep: "Search Doorstep Service",
    "other-services": "Search Other Service",
  };
  const searchPlaceholderMap = {
    products: "Search by product name or category",
    transport: "Search by cab, rental, bike, cargo",
    "delivery-partner": "Search by parcel, pickup, same day delivery",
    "stay-dining": "Search hotel, homestay, restaurant",
    "property-buy-sell": "Search by plot, flat, house, broker",
    doorstep: "Search cleaning, repair, courier",
    "other-services": "Search by other service name or category",
  };
  const emptyMatchMap = {
    products: "No matching products found",
    transport: "No matching transport service found",
    "delivery-partner": "No matching delivery service found",
    "stay-dining": "No matching stay/dining service found",
    "property-buy-sell": "No matching property service found",
    doorstep: "No matching doorstep service found",
    "other-services": "No matching other service found",
  };
  const emptyDefaultMap = {
    products: "No products yet",
    transport: "No transport service yet",
    "delivery-partner": "No delivery service yet",
    "stay-dining": "No stay/dining service yet",
    "property-buy-sell": "No property service yet",
    doorstep: "No doorstep service yet",
    "other-services": "No other service yet",
  };
  const sectionLabelMap = {
    products: "Product Gallery",
    transport: "Transport Gallery",
    "delivery-partner": "Delivery Service Gallery",
    "stay-dining": "Stay & Dining Gallery",
    "property-buy-sell": "Property Service Gallery",
    doorstep: "Doorstep Services Gallery",
    "other-services": "Other Services Gallery",
  };
  const activeTabLabel = tabLabelMap[activeTab] || tabLabelMap.products;
  const activeSearchLabel = searchLabelMap[activeTab] || searchLabelMap.products;
  const activeSearchPlaceholder = searchPlaceholderMap[activeTab] || searchPlaceholderMap.products;
  const activeEmptyMessage = (gallerySearch ? emptyMatchMap : emptyDefaultMap)[activeTab] || (gallerySearch ? emptyMatchMap.products : emptyDefaultMap.products);
  const activeSectionLabel = sectionLabelMap[activeTab] || sectionLabelMap.products;

  const isBookNowRole = !user || ["member", "customer"].includes(String(user?.role || "").toLowerCase());
  const canAccessProductPdf = ["partner", "admin", "super_admin", "company_admin"].includes(String(user?.role || "").toLowerCase());
  const getStock = (product) => Math.max(0, Number(product?.stock ?? 0));
  const visibleProducts = useMemo(() => {
    const source = gallerySearch ? activeListings.filter((p) => {
      const q = String(gallerySearch || "").trim().toLowerCase();
      const qDigits = q.replace(/\D/g, "");

      const deliveryLocationFields = activeTab === "delivery-partner"
        ? [
          partner?.city,
          partner?.state,
          partner?.pincode,
          p?.city,
          p?.state,
          p?.pincode,
          p?.delivery_city,
          p?.delivery_state,
          p?.delivery_pincode,
          p?.service_city,
          p?.service_state,
          p?.service_pincode,
          p?.service_area,
          p?.area,
          p?.locality,
          p?.pickup,
          p?.destination,
          p?.notes,
        ]
        : [];

      const haystackParts = [
        p?.name,
        p?.category,
        p?.description,
        ...deliveryLocationFields,
      ];

      const haystack = haystackParts
        .map((v) => String(v || "").toLowerCase())
        .join(" ");

      if (haystack.includes(q)) return true;

      if (qDigits) {
        const pincodeDigits = haystackParts
          .map((v) => String(v || "").replace(/\D/g, ""))
          .join(" ");
        return pincodeDigits.includes(qDigits);
      }

      return false;
    }) : activeListings;
    return source;
  }, [activeListings, activeTab, gallerySearch, partner?.city, partner?.pincode, partner?.state]);
  const canDownloadPdf = ["partner", "admin", "super_admin", "company_admin"].includes(String(user?.role || "").toLowerCase());
  const guestServiceHintRef = useRef(false);

  const getCartMeasureUnit = (product, preferredUnit = "") => {
    const productId = String(product?.id || "");
    return resolveMeasureUnit(product, preferredUnit || cartUnits[productId] || "");
  };

  const updateCartMeasureUnit = (productId, nextUnit) => {
    const product = products.find((item) => String(item?.id) === String(productId));
    if (!product) return;
    const resolved = resolveMeasureUnit(product, nextUnit);
    setCartUnits((prev) => ({ ...prev, [productId]: resolved }));
  };

  const addToCart = (productOrId, preferredUnit = "") => {
    const product = typeof productOrId === "object"
      ? productOrId
      : products.find((x) => String(x.id) === String(productOrId));
    const id = product?.id;
    if (!id) return;
    const isService = isServiceListing(product);
    if (isService) {
      setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
      if (!user && !guestServiceHintRef.current) {
        guestServiceHintRef.current = true;
        toast.info("Guest mode: reward attribution-এর জন্য checkout-এ Member ID/Code দিন");
      }
      return;
    }

    const stock = getStock(product);
    const activeMeasureUnit = getCartMeasureUnit(product, preferredUnit);
    const step = getQtyStep(product, activeMeasureUnit);
    if (stock <= 0) {
      toast.error(`${product?.name || "Product"}: out of stock`);
      return;
    }

    setCart((c) => {
      const current = Number(c[id] || 0);
      const nextQty = normalizeQtyByUnit(current + step, product, activeMeasureUnit);
      if (nextQty > stock) {
        toast.error(`${product?.name || "Product"}: max available stock is ${stock}`);
        return c;
      }
      return { ...c, [id]: nextQty };
    });
    setCartUnits((prev) => ({ ...prev, [id]: activeMeasureUnit }));
  };
  const decCart = (productOrId, preferredUnit = "") => {
    const product = typeof productOrId === "object"
      ? productOrId
      : products.find((x) => String(x.id) === String(productOrId));
    const id = product?.id;
    if (!id) return;
    if (isServiceListing(product)) {
      setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] || 0) - 1) }));
      return;
    }
    const activeMeasureUnit = getCartMeasureUnit(product, preferredUnit);
    const step = getQtyStep(product, activeMeasureUnit);
    setCart((c) => {
      const current = Number(c[id] || 0);
      const nextQty = normalizeQtyByUnit(current - step, product, activeMeasureUnit);
      return { ...c, [id]: Math.max(0, nextQty) };
    });
  };

  useEffect(() => {
    if (!products.length) return;
    setCart((prev) => {
      const next = {};
      Object.entries(prev).forEach(([id, qty]) => {
        const product = products.find((x) => String(x.id) === String(id));
        const isService = isServiceListing(product);
        if (isService) {
          const normalized = Math.max(0, Number(qty) || 0);
          if (normalized > 0) next[id] = normalized;
          return;
        }
        const stock = getStock(product);
        const normalized = Math.min(normalizeQtyByUnit(qty, product, cartUnits[id] || ""), stock);
        if (normalized > 0) next[id] = normalized;
      });
      return next;
    });
    setCartUnits((prev) => {
      const next = {};
      Object.entries(prev).forEach(([id, unit]) => {
        const product = products.find((x) => String(x.id) === String(id));
        if (!product) return;
        next[id] = resolveMeasureUnit(product, unit);
      });
      return next;
    });
  }, [products]);

  const items = useMemo(() =>
    Object.entries(cart).filter(([, q]) => q > 0).map(([id, q]) => {
      const p = products.find((x) => String(x.id) === String(id));
      return {
        ...p,
        quantity: q,
        quantity_label: isServiceListing(p) ? String(q) : formatQtyForMeasureUnit(q, p, resolveMeasureUnit(p, cartUnits[id] || "")),
        subtotal: (p?.price || 0) * q,
        delivery_charge: Math.max(0, Number(p?.delivery_charge || 0)),
        free_delivery_threshold: Math.max(0, Number(p?.free_delivery_threshold || 0)),
        image_url: p?.image_url || "",
        pdf_url: getPdfUrl(p),
        listing_type: isServiceListing(p) ? "service" : "product",
        item_kind: isServiceListing(p) ? "service" : "product",
        is_service: isServiceListing(p),
      };
    }),
    [cart, cartUnits, products]
  );
  const merchandiseSubtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const deliveryGroups = items.reduce((groups, item) => { const key = String(item.category || "General").trim().toLowerCase(); const group = groups[key] || { subtotal: 0, charge: 0, threshold: 0 }; group.subtotal += item.subtotal; group.charge = Math.max(group.charge, Number(item.delivery_charge || 0)); group.threshold = Math.max(group.threshold, Number(item.free_delivery_threshold || 0)); groups[key] = group; return groups; }, {});
  const deliveryByCategory = Object.fromEntries(Object.entries(deliveryGroups).map(([key, group]) => [key, group.threshold > 0 && group.subtotal >= group.threshold ? 0 : group.charge]));
  const cartDeliveryTotal = Math.max(0, ...Object.values(deliveryByCategory));
  const checkoutItems = items.map((item, index) => ({ ...item, delivery_total: index === 0 ? cartDeliveryTotal : 0 }));
  const total = merchandiseSubtotal + cartDeliveryTotal;

  const galleryUrl = `${window.location.origin}/gallery/${partnerCode}`;
  const partnerChatUrl = ownerChatUrl(partner);
  const partnerBusinessYoutubeUrl =
    normalizeYoutubeUrl(partner?.business_youtube_url) ||
    normalizeYoutubeUrl(paymentProfile?.business_youtube_url) ||
    normalizeYoutubeUrl(partner?.business_facebook_url) ||
    normalizeYoutubeUrl(paymentProfile?.business_facebook_url);
  const partnerBusinessFacebookUrl =
    normalizeFacebookUrl(partner?.business_facebook_url) ||
    normalizeFacebookUrl(paymentProfile?.business_facebook_url) ||
    normalizeFacebookUrl(partner?.business_youtube_url) ||
    normalizeFacebookUrl(paymentProfile?.business_youtube_url);

  useEffect(() => {
    if (!deliveryBookingOpen || !deliveryBookingService?.id) {
      setDeliveryFareEstimate(null);
      setDeliveryFareEstimateLoading(false);
      return;
    }

    const pickup = String(deliveryBookingForm.pickup || "").trim();
    const destination = String(deliveryBookingForm.destination || "").trim();
    if (!pickup || !destination) {
      setDeliveryFareEstimate(null);
      setDeliveryFareEstimateLoading(false);
      return;
    }

    const requestId = deliveryEstimateRequestRef.current + 1;
    deliveryEstimateRequestRef.current = requestId;
    setDeliveryFareEstimateLoading(true);

    let cancelled = false;
    void estimateDeliveryFareFromRoute(pickup, destination, deliveryBookingService)
      .then((estimate) => {
        if (cancelled || requestId !== deliveryEstimateRequestRef.current) return;
        setDeliveryFareEstimate(estimate || null);
      })
      .catch(() => {
        if (!cancelled && requestId === deliveryEstimateRequestRef.current) {
          setDeliveryFareEstimate(null);
        }
      })
      .finally(() => {
        if (!cancelled && requestId === deliveryEstimateRequestRef.current) {
          setDeliveryFareEstimateLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deliveryBookingOpen, deliveryBookingService, deliveryBookingForm.destination, deliveryBookingForm.pickup]);

  useEffect(() => {
    const ref = String(guestMemberRef || "").trim();
    if (!deliveryBookingOpen || !ref) {
      setDeliveryMemberLookupInfo(null);
      setDeliveryMemberLookupBusy(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setDeliveryMemberLookupBusy(true);
      try {
        const { data } = await api.get(`/member-lookup/${encodeURIComponent(ref)}`);
        setDeliveryMemberLookupInfo(data || null);
        setDeliveryBookingForm((prev) => ({
          ...prev,
          customer_name: String(prev.customer_name || "").trim() || String(data?.name || "").trim(),
          customer_phone: String(prev.customer_phone || "").trim() || String(data?.phone || "").trim(),
          receiver_name: String(prev.receiver_name || "").trim() || String(data?.name || "").trim(),
          receiver_phone: String(prev.receiver_phone || "").trim() || String(data?.phone || "").trim(),
        }));
      } catch {
        setDeliveryMemberLookupInfo(null);
      } finally {
        setDeliveryMemberLookupBusy(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [deliveryBookingOpen, guestMemberRef]);

  const handleBookNow = (listing) => {
    if (!listing?.id) return;
    if (activeTab === "delivery-partner" || isDeliveryServiceLike(listing)) {
      setDeliveryBookingService(listing);
      setDeliveryBookingForm({
        customer_name: "",
        customer_phone: "",
        receiver_name: "",
        receiver_phone: "",
        pickup: "",
        destination: "",
        travel_date: "",
        notes: "",
      });
      setDeliveryBooking(null);
      setDeliveryBookingOpen(true);
      setSelected(null);
      return;
    }
    setCart((prev) => ({ ...prev, [listing.id]: 1 }));
    setSelected(null);
    if (!user && isServiceListing(listing) && !guestServiceHintRef.current) {
      guestServiceHintRef.current = true;
      toast.info("Guest mode: reward attribution-এর জন্য checkout-এ Member ID/Code দিন");
    }
    toast.success(`${listing.name || "Service"} added to cart`);
  };

  const submitDeliveryBooking = async () => {
    const bookingService = deliveryBookingService || deliveryListings[0] || null;
    const pickup = String(deliveryBookingForm.pickup || "").trim();
    const destination = String(deliveryBookingForm.destination || "").trim();
    const customerName = String(deliveryBookingForm.customer_name || "").trim();
    const customerPhone = String(deliveryBookingForm.customer_phone || "").trim();
    const receiverName = String(deliveryBookingForm.receiver_name || "").trim();
    const receiverPhone = String(deliveryBookingForm.receiver_phone || "").trim();
    if (!bookingService?.id) {
      toast.error("Delivery service select করুন");
      return;
    }
    if (!customerName) {
      toast.error("Customer name দিন");
      return;
    }
    if (!customerPhone) {
      toast.error("Mobile number দিন");
      return;
    }
    if (!receiverName) {
      toast.error("Receiver name দিন");
      return;
    }
    if (!receiverPhone) {
      toast.error("Receiver mobile number দিন");
      return;
    }
    if (!pickup) {
      toast.error("Pickup দিন");
      return;
    }
    if (!destination) {
      toast.error("Destination দিন");
      return;
    }

    const estimate = deliveryFareEstimate || await estimateDeliveryFareFromRoute(pickup, destination, bookingService);
    setDeliveryBookingBusy(true);
    try {
      const manualMemberRef = String(guestMemberRef || "").trim();
      const autoMemberRef = String(user?.role || "").toLowerCase() === "member" ? String(user?.id || "").trim() : "";
      const { data } = await api.post("/delivery/bookings", {
        partner_code: partnerCode,
        service_product_id: bookingService.id,
        customer_name: customerName,
        customer_phone: customerPhone,
        receiver_name: receiverName,
        receiver_phone: receiverPhone,
        pickup,
        destination,
        travel_date: String(deliveryBookingForm.travel_date || "").trim(),
        notes: String(deliveryBookingForm.notes || "").trim(),
        member_ref: manualMemberRef || autoMemberRef,
        estimated_fare: estimate?.amount || null,
      });
      setDeliveryBooking(data?.booking || null);
      toast.success("Delivery booking submitted. Partner will confirm the final rate.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Delivery booking failed");
    } finally {
      setDeliveryBookingBusy(false);
    }
  };

  const refreshDeliveryBooking = async () => {
    const id = String(deliveryBooking?.id || "").trim();
    if (!id) return;
    try {
      const phone = String(deliveryBookingForm?.customer_phone || deliveryBooking?.customer_phone || "").trim();
      const { data } = await api.get(`/delivery/bookings/${id}`, {
        params: !user ? { customer_phone: phone } : undefined,
      });
      setDeliveryBooking(data?.booking || null);
      if (String(data?.booking?.status || "") === "confirmed") {
        toast.success("Delivery booking confirmed by partner");
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Refresh failed");
    }
  };

  useEffect(() => {
    const activeStatuses = new Set(["confirmed", "pickup_assigned", "picked_up", "in_transit", "out_for_delivery"]);
    if (!deliveryBooking?.id || !activeStatuses.has(String(deliveryBooking.status || "").toLowerCase())) return undefined;
    const intervalId = window.setInterval(async () => {
      try {
        const phone = String(deliveryBookingForm?.customer_phone || deliveryBooking?.customer_phone || "").trim();
        const { data } = await api.get(`/delivery/bookings/${deliveryBooking.id}`, {
          params: !user ? { customer_phone: phone } : undefined,
        });
        setDeliveryBooking(data?.booking || null);
      } catch {
        // Keep the last known delivery state while the customer is offline.
      }
    }, 10000);
    return () => window.clearInterval(intervalId);
  }, [deliveryBooking?.id, deliveryBooking?.status, deliveryBooking?.customer_phone, deliveryBookingForm?.customer_phone, user]);

  const shareWhatsApp = () => {
    if (!partner) return;
    const productLines = visibleProducts.slice(0, 8).map(p =>
      `• ${p.name} — ₹${p.price}${(p.image_url || getPdfUrl(p)) ? `\n  ${p.image_url || getPdfUrl(p)}` : ""}`
    ).join("\n");
    const msg = `🛍️ *${partner.business_name}* এর ${activeSectionLabel}\n\n${productLines}\n\n👉 সব দেখুন ও Order করুন:\n${galleryUrl}?tab=${activeTab}`;
    openWhatsAppShare({ text: msg });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(galleryUrl);
      toast.success("Gallery link copied!");
    } catch {
      toast.error("Copy failed");
    }
  };

  const downloadPDF = useCallback(async () => {
    if (!canDownloadPdf) {
      toast.error("PDF download is partner-only.");
      return;
    }
    if (!partner || visibleProducts.length === 0) { toast.error("No products to export"); return; }
    toast.info("Generating PDF, please wait...");

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(); // 210mm
    const COLS = 2;
    const CARD_W = (W - 18) / COLS; // ~96mm
    const IMG_H = 60;
    const CARD_H = IMG_H + 28;
    const MARGIN = 6;

    // Helper: load image URL → dataURL via canvas
    const loadImg = (url) => new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth || 400;
          c.height = img.naturalHeight || 400;
          c.getContext("2d").drawImage(img, 0, 0);
          resolve(c.toDataURL("image/jpeg", 0.75));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url + (url.includes("?") ? "&" : "?") + "_t=" + Date.now();
    });

    // Header
    doc.setFillColor(5, 46, 22);
    doc.rect(0, 0, W, 28, "F");
    doc.setTextColor(251, 191, 36);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(partner.business_name, 10, 12);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text(`${partner.business_type || ""} · ${partner.phone || ""} · ${partner.partner_code}`, 10, 20);
    doc.setTextColor(255, 255, 255);
    doc.text("METHO Product Catalog", W - 10, 10, { align: "right" });
    doc.text(new Date().toLocaleDateString("en-IN"), W - 10, 17, { align: "right" });
    doc.text(`methoaayupay.com/gallery/${partner.partner_code}`, W - 10, 24, { align: "right" });

    // Compact brand banner with direct shop link (opens cart-enabled gallery)
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(16, 185, 129);
    doc.roundedRect(8, 29, W - 16, 8, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(5, 46, 22);
    doc.text(`METHO + ${partner.business_name}`, 11, 34);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(21, 128, 61);
    doc.textWithLink("Open Partner Shop", W - 67, 34, { url: galleryUrl });

    let y = 40;

    for (let i = 0; i < visibleProducts.length; i++) {
      const col = i % COLS;
      const x = MARGIN + col * (CARD_W + 3);

      if (col === 0 && i > 0) y += CARD_H + 4;
      if (y + CARD_H > 285) { doc.addPage(); y = 10; }

      const p = visibleProducts[i];

      // Card background
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(220, 220, 220);
      doc.roundedRect(x, y, CARD_W, CARD_H, 2, 2, "FD");

      // Product image
      const imgData = await loadImg(p.image_url || "");
      if (imgData) {
        doc.addImage(imgData, "JPEG", x + 1, y + 1, CARD_W - 2, IMG_H - 1, "", "MEDIUM");
      } else {
        // Placeholder
        doc.setFillColor(226, 232, 240);
        doc.rect(x + 1, y + 1, CARD_W - 2, IMG_H - 1, "F");
        doc.setTextColor(148, 163, 184);
        doc.setFontSize(8);
        doc.text("No Image", x + CARD_W / 2, y + IMG_H / 2, { align: "center" });
      }

      // Product info below image
      const infoY = y + IMG_H + 4;
      doc.setTextColor(5, 46, 22);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      const name = (p.name || "").substring(0, 28);
      doc.text(name, x + 3, infoY);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(p.category || "", x + 3, infoY + 5);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(5, 46, 22);
      doc.text(`\u20B9${p.price}`, x + 3, infoY + 12);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(`Stock: ${p.stock ?? 0}`, x + CARD_W - 3, infoY + 12, { align: "right" });

      // Clickable product link: opens this product in gallery where cart flow lives.
      const productLink = `${galleryUrl}?p=${p.id}`;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(21, 128, 61);
      doc.textWithLink("View in Gallery / Add to Cart", x + 3, infoY + 18, { url: productLink });
    }

    // Footer
    const totalPages = doc.internal.getNumberOfPages();
    for (let pg = 1; pg <= totalPages; pg++) {
      doc.setPage(pg);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(21, 128, 61);
      doc.textWithLink(`Order online: methoaayupay.com/gallery/${partner.partner_code}`, W / 2, 288, { url: galleryUrl });
      doc.setFontSize(6);
      doc.setTextColor(148, 163, 184);
      doc.text(`Order করুন: methoaayupay.com/gallery/${partner.partner_code}  ·  Page ${pg}/${totalPages}`, W / 2, 292, { align: "center" });
    }

    doc.save(`${partner.partner_code}_Catalog.pdf`);
    toast.success("PDF downloaded!");
  }, [canDownloadPdf, galleryUrl, partner, visibleProducts]);

  // Auto-generate a combined PDF when opened from partner dashboard with ?autoPdf=1
  useEffect(() => {
    if (!canDownloadPdf) return;
    if (autoPdfTriggered.current) return;
    if (searchParams.get("autoPdf") !== "1") return;
    if (!partner || visibleProducts.length === 0) return;
    autoPdfTriggered.current = true;
    downloadPDF();
  }, [canDownloadPdf, downloadPDF, partner, visibleProducts, searchParams]);

  if (err) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
      <p className="text-red-700 font-semibold">{err}</p>
      <Link to="/directory" className="mt-4 text-emerald-800 hover:underline text-sm">← Back to directory</Link>
    </div>
  );
  if (!data) return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading gallery...</div>;

  return (
    <div className="min-h-screen bg-slate-50 pb-28" data-testid="partner-gallery-page">
      {/* Header */}
      <header className="bg-emerald-950 text-white sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <Link to={`/partner-shop/${partnerCode}`} className="flex items-center gap-2 text-sm hover:text-amber-400">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
          <Logo />
          <div className="flex items-center flex-wrap justify-end gap-2">
            <button onClick={copyLink} className="p-2 rounded-full hover:bg-white/10" title="Copy Link">
              <Share2 className="w-4 h-4" />
            </button>
            {canDownloadPdf ? (
              <button onClick={downloadPDF} className="p-2 rounded-full hover:bg-white/10" title="Download PDF Catalog">
                <FileDown className="w-4 h-4" />
              </button>
            ) : null}
            <button onClick={shareWhatsApp} className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white rounded-full px-3 py-1.5 text-xs font-bold">
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp Share
            </button>
          </div>
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

      {/* Partner info strip */}
      <div className={`bg-gradient-to-r from-emerald-900 to-emerald-800 text-white ${items.length > 0 ? "mt-20 md:mt-0" : ""}`}>
        <div className="max-w-4xl mx-auto px-4 py-5 flex flex-wrap items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-amber-400 text-emerald-950 flex items-center justify-center shrink-0 overflow-hidden">
            {partner.logo_url ? <img src={partner.logo_url} alt="" className="w-full h-full object-cover" /> : <Store className="w-7 h-7" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-amber-400 font-bold flex items-center gap-1.5">
              {partner.partner_code} · Verified
              {partner.is_featured && <Star className="w-3 h-3 fill-amber-400 text-amber-400" />}
            </p>
            <h1 className="font-display font-black text-xl text-white">{partner.business_name}</h1>
            <p className="text-emerald-100/70 text-xs mt-0.5">
              {[partner.city, partner.state].filter(Boolean).join(", ")}
              {partner.phone && <span> · <Phone className="w-3 h-3 inline" /> {partner.phone}</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-amber-400 uppercase font-bold">{activeTabLabel}</p>
            <p className="font-display font-black text-3xl">{activeListings.length}</p>
          </div>
          {partnerChatUrl ? (
            <a
              href={partnerChatUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-green-500 px-4 py-2 text-xs font-bold text-white hover:bg-green-600"
              data-testid="gallery-chat-owner"
            >
              <MessageCircle className="w-3.5 h-3.5" /> Chat with Owner
            </a>
          ) : null}
          {partnerBusinessYoutubeUrl ? (
            <button
              type="button"
              onClick={() => window.open(partnerBusinessYoutubeUrl, "_blank", "noopener,noreferrer")}
              className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-xs font-bold text-emerald-950 hover:bg-amber-300"
              data-testid="gallery-watch-business-video"
            >
              <PlayCircle className="w-3.5 h-3.5" /> Watch Video
            </button>
          ) : null}
          {partnerBusinessFacebookUrl ? (
            <button
              type="button"
              onClick={() => window.open(partnerBusinessFacebookUrl, "_blank", "noopener,noreferrer")}
              className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2 text-xs font-bold text-white hover:bg-sky-600"
              data-testid="gallery-open-business-facebook"
            >
              Facebook
            </button>
          ) : null}
        </div>
      </div>

      {/* Toolbar */}
      <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 font-body">
          {activeTab === "transport"
            ? "Tap the image to view details and start ride booking"
            : ((activeTab === "stay-dining" || activeTab === "doorstep" || activeTab === "other-services") ? "Tap the image to view details and book the service" : "Tap the image to view details and add to cart")}
        </p>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          {allowedTabs.includes("products") ? (
          <Link to={`/gallery/${partnerCode}?tab=products${gallerySearch ? `&q=${encodeURIComponent(gallerySearch)}` : ""}`}>
            <Button variant={activeTab === "products" ? "default" : "outline"} size="sm" className={`rounded-full text-xs ${activeTab === "products" ? "bg-emerald-900 hover:bg-emerald-950 text-white" : "border-emerald-300 text-emerald-900 hover:bg-emerald-50"}`}>
              Products
            </Button>
          </Link>
          ) : null}
          {allowedTabs.includes("transport") ? (
          <Link to={`/gallery/${partnerCode}?tab=transport${gallerySearch ? `&q=${encodeURIComponent(gallerySearch)}` : ""}`}>
            <Button variant={activeTab === "transport" ? "default" : "outline"} size="sm" className={`rounded-full text-xs ${activeTab === "transport" ? "bg-sky-700 hover:bg-sky-800 text-white" : "border-sky-300 text-sky-900 hover:bg-sky-50"}`}>
              Transport
            </Button>
          </Link>
          ) : null}
          {allowedTabs.includes("stay-dining") ? (
          <Link to={`/gallery/${partnerCode}?tab=stay-dining${gallerySearch ? `&q=${encodeURIComponent(gallerySearch)}` : ""}`}>
            <Button variant={activeTab === "stay-dining" ? "default" : "outline"} size="sm" className={`rounded-full text-xs ${activeTab === "stay-dining" ? "bg-amber-600 hover:bg-amber-700 text-white" : "border-amber-300 text-amber-900 hover:bg-amber-50"}`}>
              Stay & Dining
            </Button>
          </Link>
          ) : null}
          {allowedTabs.includes("delivery-partner") ? (
          <Link to={`/gallery/${partnerCode}?tab=delivery-partner${gallerySearch ? `&q=${encodeURIComponent(gallerySearch)}` : ""}`}>
            <Button variant={activeTab === "delivery-partner" ? "default" : "outline"} size="sm" className={`rounded-full text-xs ${activeTab === "delivery-partner" ? "bg-cyan-700 hover:bg-cyan-800 text-white" : "border-cyan-300 text-cyan-900 hover:bg-cyan-50"}`}>
              Delivery
            </Button>
          </Link>
          ) : null}
          {allowedTabs.includes("property-buy-sell") ? (
          <Link to={`/gallery/${partnerCode}?tab=property-buy-sell${gallerySearch ? `&q=${encodeURIComponent(gallerySearch)}` : ""}`}>
            <Button variant={activeTab === "property-buy-sell" ? "default" : "outline"} size="sm" className={`rounded-full text-xs ${activeTab === "property-buy-sell" ? "bg-indigo-700 hover:bg-indigo-800 text-white" : "border-indigo-300 text-indigo-900 hover:bg-indigo-50"}`}>
              Property
            </Button>
          </Link>
          ) : null}
          {allowedTabs.includes("doorstep") ? (
          <Link to={`/gallery/${partnerCode}?tab=doorstep${gallerySearch ? `&q=${encodeURIComponent(gallerySearch)}` : ""}`}>
            <Button variant={activeTab === "doorstep" ? "default" : "outline"} size="sm" className={`rounded-full text-xs ${activeTab === "doorstep" ? "bg-violet-700 hover:bg-violet-800 text-white" : "border-violet-300 text-violet-900 hover:bg-violet-50"}`}>
              Doorstep
            </Button>
          </Link>
          ) : null}
          {allowedTabs.includes("other-services") ? (
          <Link to={`/gallery/${partnerCode}?tab=other-services${gallerySearch ? `&q=${encodeURIComponent(gallerySearch)}` : ""}`}>
            <Button variant={activeTab === "other-services" ? "default" : "outline"} size="sm" className={`rounded-full text-xs ${activeTab === "other-services" ? "bg-emerald-900 hover:bg-emerald-950 text-white" : "border-emerald-300 text-emerald-900 hover:bg-emerald-50"}`}>
              Other Services
            </Button>
          </Link>
          ) : null}
          {canDownloadPdf ? (
            <Button variant="outline" size="sm" onClick={downloadPDF} className="rounded-full border-emerald-800 text-emerald-900 text-xs">
              Partner PDF Catalog
            </Button>
          ) : null}
          <Button size="sm" onClick={shareWhatsApp} className="rounded-full bg-green-600 hover:bg-green-700 text-white text-xs">
            <MessageCircle className="w-3.5 h-3.5 mr-1" /> Share on WhatsApp
          </Button>
        </div>
      </div>

      {!canDownloadPdf ? (
        <div className="max-w-4xl mx-auto px-4 pb-2">
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900" data-testid="gallery-pdf-role-note">
            Catalog PDF export and download are enabled only for Admin/Partner accounts. The Member/Customer cart flow remains unchanged.
          </div>
        </div>
      ) : null}

      <div className="max-w-4xl mx-auto px-4 pb-4">
        <div className="bg-white rounded-xl border border-border p-4 flex flex-col md:flex-row gap-2 md:items-center">
          <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm shrink-0">
            <Search className="w-4 h-4" /> {activeSearchLabel}
          </div>
          <Input
            value={gallerySearch}
            onChange={(e) => setGallerySearch(e.target.value)}
            placeholder={activeSearchPlaceholder}
            className="rounded-full"
          />
          {gallerySearch ? (
            <Button
              type="button"
              variant="outline"
              className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50 shrink-0"
              onClick={() => setGallerySearch("")}
            >
              Clear Search
            </Button>
          ) : null}
        </div>
      </div>

      {/* Image Gallery Grid */}
      <main className="max-w-4xl mx-auto px-4">
        {visibleProducts.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-border">
            <Store className="w-10 h-10 text-slate-400 mx-auto" />
            <p className="mt-3 font-semibold text-emerald-950">{activeEmptyMessage}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {visibleProducts.map(p => {
              const qty = cart[p.id] || 0;
              const activeMeasureUnit = getCartMeasureUnit(p);
              const isService = isServiceListing(p);
              const isTransport = isTransportServiceListing(p);
              const outOfStock = !isService && (p.stock ?? 0) <= 0;
              const subtotal = subtotalForQuantity(qty, p);
              const selectableUnits = getSelectableMeasureUnits(p);
              return (
                <div
                  key={p.id}
                  className="group relative bg-white rounded-xl overflow-hidden border border-border hover:shadow-lg transition-all cursor-pointer"
                  data-testid={`gallery-product-${p.id}`}
                  onClick={() => setSelected(p)}
                >
                  {/* Product image */}
                  <div className="aspect-square overflow-hidden bg-slate-100 relative">
                    <img
                      src={getDisplayImage(p)}
                      alt={p.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                      decoding="async"
                      onError={e => { applyImageFallback(e, p?.fallback_image_url || ""); }}
                    />
                    {outOfStock && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="text-white text-[10px] font-black uppercase tracking-widest bg-black/60 px-2 py-1 rounded-full">Out of Stock</span>
                      </div>
                    )}
                    {qty > 0 && (
                      <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-black shadow">
                        {formatQty(convertQtyBetweenUnits(qty, getUnitType(p), activeMeasureUnit))}
                      </div>
                    )}
                  </div>
                  {/* Info */}
                  <div className="p-2.5">
                    <p className={`text-[10px] uppercase tracking-widest font-semibold truncate ${isTransport ? "text-sky-700" : "text-emerald-800"}`}>{p.category}</p>
                    <p className="font-display font-bold text-emerald-950 text-sm line-clamp-1 mt-0.5">{p.name}</p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <div>
                        <span className="font-display font-black text-base text-emerald-950">₹{p.price}</span>
                        {!isService ? <p className="text-[11px] text-slate-500">{formatPriceForMeasureUnit(p.price, p, activeMeasureUnit)}</p> : null}
                      </div>
                    </div>
                    {!isService && selectableUnits.length > 1 ? (
                      <select
                        value={activeMeasureUnit}
                        onChange={(e) => {
                          e.stopPropagation();
                          updateCartMeasureUnit(p.id, e.target.value);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-2 h-9 w-full rounded-full border border-input bg-white px-3 text-xs"
                      >
                        {selectableUnits.map((unit) => (
                          <option key={unit} value={unit}>{unit}</option>
                        ))}
                      </select>
                    ) : null}
                    {outOfStock ? (
                      <Button disabled className="w-full mt-2 rounded-full h-9">Out of Stock</Button>
                    ) : isService ? (
                      <div className="mt-2 space-y-2">
                        <Button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            if (activeTab === "delivery-partner" || isDeliveryServiceLike(p)) {
                              setDeliveryBookingService(p);
                              setDeliveryBookingForm({
                                customer_name: "",
                                customer_phone: "",
                                receiver_name: "",
                                receiver_phone: "",
                                pickup: "",
                                destination: "",
                                travel_date: "",
                                notes: "",
                              });
                              setDeliveryBooking(null);
                              setDeliveryBookingOpen(true);
                              return;
                            }
                            handleBookNow(p);
                          }}
                          className={`w-full rounded-full h-9 text-white ${isTransport ? "bg-sky-700 hover:bg-sky-800" : "bg-emerald-900 hover:bg-emerald-950"}`}
                          data-testid={`quick-add-${p.id}`}
                        >
                          {activeTab === "delivery-partner" || isDeliveryServiceLike(p) ? "Book Delivery" : "Book Now"}
                        </Button>
                      </div>
                    ) : qty > 0 ? (
                      <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                        <div
                          className="flex items-center justify-between bg-emerald-50 rounded-full px-2 py-1"
                          data-testid={`quick-stepper-${p.id}`}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              decCart(p.id, activeMeasureUnit);
                            }}
                            className="w-8 h-8 rounded-full bg-white flex items-center justify-center hover:bg-emerald-100"
                            data-testid={`quick-dec-${p.id}`}
                            aria-label={`Decrease ${p.name}`}
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="font-bold text-emerald-950 text-sm" data-testid={`quick-qty-${p.id}`}>
                            {formatQtyForMeasureUnit(qty, p, activeMeasureUnit)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              addToCart(p.id, activeMeasureUnit);
                            }}
                            className="w-8 h-8 rounded-full bg-white flex items-center justify-center hover:bg-emerald-100"
                            data-testid={`quick-inc-${p.id}`}
                            aria-label={`Increase ${p.name}`}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        <p className="text-[11px] font-semibold text-emerald-900 text-center">₹{subtotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          addToCart(p.id, activeMeasureUnit);
                          toast.success(`${p.name} added`);
                        }}
                        className={`w-full mt-2 rounded-full h-9 text-white ${isTransport ? "bg-sky-700 hover:bg-sky-800" : "bg-emerald-900 hover:bg-emerald-950"}`}
                        data-testid={`quick-add-${p.id}`}
                      >
                        Add to Cart
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Product Detail Modal */}
      {selected && (
        <ProductModal
          product={selected}
          qty={cart[selected.id] || 0}
          measureUnit={getCartMeasureUnit(selected)}
          onMeasureUnitChange={updateCartMeasureUnit}
          galleryUrl={galleryUrl}
          isBookNowRole={isBookNowRole}
          onBookNow={handleBookNow}
          canAccessProductPdf={canAccessProductPdf}
          onCheckout={() => { setSelected(null); setCheckoutOpen(true); }}
          onClose={() => setSelected(null)}
          onAdd={id => { addToCart(id, getCartMeasureUnit(selected)); }}
          onDec={id => { decCart(id, getCartMeasureUnit(selected)); if ((cart[id] || 0) <= 1) setSelected(null); }}
        />
      )}

      {/* Cart bar */}
      {items.length > 0 && (
        <div className="fixed top-16 md:top-auto md:bottom-0 left-0 right-0 z-40 p-3 bg-white border-b md:border-b-0 md:border-t border-border shadow-2xl" data-testid="gallery-cart-bar">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-emerald-800 font-bold flex items-center gap-1.5">
                <ShoppingCart className="w-3.5 h-3.5" /> {items.length} item(s)
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {items.map(i => `${i.name} ×${formatQtyForMeasureUnit(i.quantity, i, getCartMeasureUnit(i))}`).join(", ")}
              </p>
            </div>
            <Button
              onClick={() => setCheckoutOpen(true)}
              className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-5 shrink-0 w-full sm:w-auto"
              data-testid="gallery-checkout-btn"
            >
              Checkout · ₹{total.toLocaleString("en-IN")}
            </Button>
          </div>
        </div>
      )}

      <UpiPaymentDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
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
          setCheckoutOpen(false);
          setGuestMemberRef("");
          setCart({});
          setCartUnits({});
          setSelected(null);
        }}
      />

      {deliveryBookingOpen ? (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start md:items-center justify-center overflow-y-auto p-2 sm:p-4" onClick={() => setDeliveryBookingOpen(false)}>
          <div className="w-full max-w-2xl max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-cyan-200 p-4 sm:p-5 md:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-cyan-700 font-semibold">Delivery Booking Preset</p>
                <h3 className="font-display font-black text-emerald-950 text-lg sm:text-xl mt-1 leading-tight">Pickup, Destination & Rate Confirm</h3>
                <p className="text-sm text-slate-600 mt-1">Rate estimate দেখুন। Agree করলে submit করুন, না হলে partner final rate confirm করবে.</p>
              </div>
              <Button type="button" variant="outline" className="rounded-full" onClick={() => setDeliveryBookingOpen(false)}>
                Close
              </Button>
            </div>

            {deliveryBooking?.id ? (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs text-emerald-900 font-semibold">Booking ID: {deliveryBooking.trip_code || deliveryBooking.id}</p>
                <p className="text-xs text-slate-700 mt-1">Status: <span className="font-semibold uppercase">{deliveryBooking.status}</span></p>
                <p className="text-xs text-slate-700">Quoted Fare: ₹{Number(deliveryBooking.fare_quote || 0).toLocaleString("en-IN")}</p>
                <p className="text-xs text-slate-700">Final Fare: {Number(deliveryBooking.fare_final || 0) > 0 ? `₹${Number(deliveryBooking.fare_final).toLocaleString("en-IN")}` : "Partner will confirm the final fare"}</p>
                <p className="text-xs text-slate-700">Route: {deliveryBooking.pickup} → {deliveryBooking.destination}</p>
                {(deliveryBooking?.driver?.live_location || deliveryBooking?.live_location) ? (
                  <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
                    <p className="text-xs font-semibold text-sky-900">Assigned delivery agent: {deliveryBooking?.driver?.name || "Active agent"}</p>
                    <p className="text-[11px] text-slate-600 mt-1">Updated {new Date((deliveryBooking.driver?.live_location || deliveryBooking.live_location).updated_at).toLocaleTimeString()}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <a href={liveLocationUrl(deliveryBooking.driver?.live_location || deliveryBooking.live_location)} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-full border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-900">Open live location</a>
                      {(deliveryBooking.driver?.phone || deliveryBooking.partner_phone) ? <a href={`tel:${deliveryBooking.driver?.phone || deliveryBooking.partner_phone}`} className="inline-flex items-center rounded-full border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-900">Call agent</a> : null}
                      {bookingWhatsAppUrl(deliveryBooking) ? <a href={bookingWhatsAppUrl(deliveryBooking)} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">WhatsApp agent</a> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input value={deliveryBookingForm.customer_name} onChange={(e) => setDeliveryBookingForm((prev) => ({ ...prev, customer_name: e.target.value }))} placeholder="Customer name" className="h-11" />
              <Input value={deliveryBookingForm.customer_phone} onChange={(e) => setDeliveryBookingForm((prev) => ({ ...prev, customer_phone: e.target.value }))} placeholder="Mobile number" className="h-11" />
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input value={deliveryBookingForm.receiver_name} onChange={(e) => setDeliveryBookingForm((prev) => ({ ...prev, receiver_name: e.target.value }))} placeholder="Receiver name" className="h-11" />
              <Input value={deliveryBookingForm.receiver_phone} onChange={(e) => setDeliveryBookingForm((prev) => ({ ...prev, receiver_phone: e.target.value }))} placeholder="Receiver mobile number" className="h-11" />
            </div>
            <Input value={guestMemberRef} onChange={(e) => setGuestMemberRef(e.target.value)} placeholder="Member ID/Code (optional for reward %)" className="h-11 mt-3" />
            {deliveryMemberLookupBusy ? <p className="text-[11px] text-slate-500 mt-1">Member lookup চলছে...</p> : null}
            {!deliveryMemberLookupBusy && deliveryMemberLookupInfo ? <p className="text-[11px] text-emerald-700 mt-1">Member found: {deliveryMemberLookupInfo?.name || "Member"}{deliveryMemberLookupInfo?.member_code ? ` · ${deliveryMemberLookupInfo.member_code}` : ""}</p> : null}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input value={deliveryBookingForm.pickup} onChange={(e) => setDeliveryBookingForm((prev) => ({ ...prev, pickup: e.target.value }))} placeholder="Pickup point" className="h-11" />
              <Input value={deliveryBookingForm.destination} onChange={(e) => setDeliveryBookingForm((prev) => ({ ...prev, destination: e.target.value }))} placeholder="Destination" className="h-11" />
            </div>

            <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 p-3">
              <p className="text-[11px] font-semibold text-cyan-900">Estimated delivery fare</p>
              <p className="text-xs text-slate-700 mt-1">
                {deliveryFareEstimateLoading ? "Calculating route rate..." : deliveryFareEstimate ? `₹${Number(deliveryFareEstimate.amount).toLocaleString("en-IN")} · ${Number(deliveryFareEstimate.distanceKm).toFixed(1)} km × ₹${Number(deliveryFareEstimate.ratePerKm).toLocaleString("en-IN")}/km` : "Pickup/destination দিলে dynamic rate show হবে"}
              </p>
              <p className="text-[11px] text-slate-600 mt-1">If you agree, submit now. If not, continue the conversation with the partner and finalize later.</p>
              <Button
                type="button"
                variant="outline"
                className="mt-3 rounded-full border-cyan-300 text-cyan-900 hover:bg-cyan-100"
                onClick={() => {
                  const url = routeMapsUrl(deliveryBookingForm.pickup, deliveryBookingForm.destination);
                  if (!url) {
                    toast.error("Pickup বা destination দিন");
                    return;
                  }
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
                data-testid="delivery-open-route-map"
              >
                Open Route in Google Maps
              </Button>
            </div>

            <div className="mt-3 rounded-lg border border-dashed border-cyan-200 bg-white p-3">
              <p className="text-[11px] text-slate-600 mb-1">Travel date and note</p>
              <Input type="datetime-local" value={deliveryBookingForm.travel_date} onChange={(e) => setDeliveryBookingForm((prev) => ({ ...prev, travel_date: e.target.value }))} className="h-11" />
              <Input value={deliveryBookingForm.notes} onChange={(e) => setDeliveryBookingForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notes (optional)" className="h-11 mt-3" />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" className="rounded-full bg-cyan-700 hover:bg-cyan-800 text-white" onClick={submitDeliveryBooking} disabled={deliveryBookingBusy || !deliveryBookingService?.id}>
                {deliveryBookingBusy ? "Submitting..." : "Confirm & Submit"}
              </Button>
              <Button type="button" variant="outline" className="rounded-full" onClick={negotiateWithPartner} data-testid="delivery-negotiate-partner-button">
                Negotiate with Partner
              </Button>
              {deliveryBooking?.id ? (
                <Button type="button" variant="outline" className="rounded-full" onClick={refreshDeliveryBooking}>Refresh Status</Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function getGstInclusivePrice(price, gstPercent) {
  const basePrice = Math.max(0, Number(price) || 0);
  const gstRate = Math.max(0, Number(gstPercent) || 0);
  return Math.round(gstRate <= 0 ? basePrice : basePrice + (basePrice * gstRate / 100));
}

export function getMethoPriceDetails(product) {
  const productType = String(product?.product_type || "metho").toLowerCase();
  const gstPercent = ["metho", "metho_service", "metho_vegetable"].includes(productType)
    ? Number(product?.gst_percent || 0)
    : 0;
  const price = getGstInclusivePrice(product?.price, gstPercent);
  const mrp = getGstInclusivePrice(Number(product?.mrp || product?.price || 0), gstPercent);
  const percent = Math.max(0, Number(product?.discount_percent || 0));
  return { price, mrp, percent, hasDiscount: percent > 0 && mrp > price };
}

const normalizeBase = (url) => String(url || "").trim().replace(/\/+$/, "");
const LEGACY_MIRRORED_PRODUCT_FILES = new Set([
  "0d0bf112-efe5-4885-9453-33c0257a45b9.png",
  "54ec197a-28bd-4763-ac39-0fcaf38c70bc.png",
  "6d8df056-9b13-475e-b7b3-02d9bffce2ba.png",
  "b9e6f196-4bad-4c35-90d4-3f425bcc0373.png",
  "f384b59f-5f38-4617-9687-6f993c392723.png",
]);

export function getBackendBaseUrl() {
  const fromEnv = normalizeBase(process.env.REACT_APP_BACKEND_URL);
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "";
    const isHostedFrontend = host === "methoaayupay.com" || host === "www.methoaayupay.com" || host.endsWith(".pages.dev");
    if (fromEnv) {
      // Protect production from accidental env values pointing to the frontend origin.
      // That configuration makes API calls return HTML instead of JSON.
      try {
        const envHost = new URL(fromEnv).hostname;
        const pointsToFrontend = envHost === host || envHost === "methoaayupay.com" || envHost === "www.methoaayupay.com" || envHost.endsWith(".pages.dev");
        if (!pointsToFrontend) return fromEnv;
      } catch {
        return fromEnv;
      }
      if (isHostedFrontend) return "https://metho-backend.onrender.com";
    }
    if (host === "methoaayupay.com" || host === "www.methoaayupay.com" || host.endsWith(".pages.dev")) {
      return "https://metho-backend.onrender.com";
    }
  }

  if (fromEnv) return fromEnv;

  return "";
}

export function getBackendBaseUrlOrDefault(fallback = "http://localhost:8000") {
  return getBackendBaseUrl() || normalizeBase(fallback);
}

export function resolveAssetUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return "";

  const normalizeApiFilePath = (value) => {
    const v = String(value || "");
    // Keep one canonical route for compatibility across both backend variants.
    return v.replace(/^\/api\/public-files\//, "/api/files/").replace(/^api\/public-files\//, "api/files/");
  };

  const normalizedUrl = normalizeApiFilePath(url);
  if (normalizedUrl.startsWith("data:") || normalizedUrl.startsWith("blob:")) return normalizedUrl;
  const mirrorProductAsset = (value) => {
    const match = String(value || "").match(/(?:^|\/)(?:product_images|product-images)\/([^/?#]+)(?:[?#].*)?$/i);
    if (!match) return "";
    if (!LEGACY_MIRRORED_PRODUCT_FILES.has(match[1])) return "";
    return `/assets/product-images/${match[1]}`;
  };
  const mirroredProductUrl = mirrorProductAsset(normalizedUrl);
  if (mirroredProductUrl) return mirroredProductUrl;
  if (normalizedUrl.startsWith("http://") || normalizedUrl.startsWith("https://")) {
    if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("http://")) {
      try {
        const parsed = new URL(normalizedUrl);
        const backendBase = getBackendBaseUrl();
        const backendHost = backendBase ? new URL(backendBase).host : "";
        const sameBackendHost = backendHost && parsed.host === backendHost;
        const renderHost = parsed.host.endsWith(".onrender.com");
        if (sameBackendHost || renderHost) {
          return `https://${normalizedUrl.slice("http://".length)}`;
        }
      } catch {
        // Fall through and return raw absolute URL on parse failure.
      }
    }
    return normalizedUrl;
  }
  if (normalizedUrl.startsWith("/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}${normalizedUrl}` : normalizedUrl;
  }
  // Legacy/compact API paths can arrive without a leading slash.
  if (normalizedUrl.startsWith("api/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}/${normalizedUrl}` : `/${normalizedUrl}`;
  }
  // Storage paths from older payloads should resolve through /api/files.
  if (normalizedUrl.startsWith("product_images/") || normalizedUrl.startsWith("payment_screenshots/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}/api/files/${normalizedUrl}` : `/api/files/${normalizedUrl}`;
  }
  if (normalizedUrl.startsWith("metho-aay-upay/product-images/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}/api/files/${normalizedUrl}` : `/api/files/${normalizedUrl}`;
  }
  if (normalizedUrl.startsWith("branding_images/") || normalizedUrl.startsWith("metho-aay-upay/branding_images/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}/api/files/${normalizedUrl}` : `/api/files/${normalizedUrl}`;
  }
  if (normalizedUrl.startsWith("media/") || normalizedUrl.startsWith("uploads/") || normalizedUrl.startsWith("static/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}/${normalizedUrl}` : normalizedUrl;
  }
  return normalizedUrl;
}

export function buildUpiPaymentUri(upiId, payeeName = "", amount = 0) {
  const normalizedUpiId = String(upiId || "").trim();
  if (!normalizedUpiId) return "";
  const params = new URLSearchParams({
    pa: normalizedUpiId,
    pn: String(payeeName || "").trim() || "METHO",
    am: Number(amount || 0).toFixed(2),
    cu: "INR",
  });
  return `upi://pay?${params.toString()}`;
}

export function getAssetImageFallbackCandidates(rawUrl, extras = []) {
  const base = getBackendBaseUrl();
  const unique = [];
  const push = (value) => {
    const next = String(value || "").trim();
    if (!next) return;
    if (!unique.includes(next)) unique.push(next);
  };
  const toAbsolute = (pathValue) => {
    const v = String(pathValue || "").trim();
    if (!v) return "";
    if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("data:") || v.startsWith("blob:")) return v;
    if (v.startsWith("/")) return base ? `${base}${v}` : v;
    return base ? `${base}/${v}` : `/${v}`;
  };

  const raw = String(rawUrl || "").trim();
  if (!raw) return unique;

  push(resolveAssetUrl(raw));

  const publicVariant = raw
    .replace("/api/files/", "/api/public-files/")
    .replace("api/files/", "api/public-files/");
  if (publicVariant !== raw) {
    push(toAbsolute(publicVariant));
  }

  const fileMatch = raw.match(/(?:^|\/)(?:product_images|product-images)\/([^/?#]+)(?:[?#].*)?$/i);
  if (fileMatch?.[1]) {
    push(`/assets/product-images/${fileMatch[1]}`);
  }

  for (const item of Array.isArray(extras) ? extras : [extras]) {
    const candidate = String(item || "").trim();
    if (!candidate) continue;
    if (candidate.startsWith("data:") || candidate.startsWith("blob:") || candidate.startsWith("http://") || candidate.startsWith("https://") || candidate.startsWith("/")) {
      push(toAbsolute(candidate));
    } else {
      push(resolveAssetUrl(candidate));
    }
  }

  return unique;
}

export function buildWhatsAppShareUrl({ text = "", phone = "" } = {}) {
  const cleanText = String(text || "").trim();
  const digits = String(phone || "").replace(/\D/g, "");
  const encodedText = encodeURIComponent(cleanText);

  if (digits) {
    return `https://wa.me/${digits}${encodedText ? `?text=${encodedText}` : ""}`;
  }

  return `https://api.whatsapp.com/send?text=${encodedText}`;
}

export function openWhatsAppShare({ text = "", phone = "" } = {}) {
  const url = buildWhatsAppShareUrl({ text, phone });
  if (typeof window === "undefined") return url;

  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) {
    window.location.href = url;
  }
  return url;
}


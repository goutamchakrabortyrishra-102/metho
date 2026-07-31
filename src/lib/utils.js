import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const normalizeBase = (url) => String(url || "").trim().replace(/\/+$/, "");

export function getBackendBaseUrl() {
  const fromEnv = normalizeBase(process.env.REACT_APP_BACKEND_URL);
  if (fromEnv) return fromEnv;

  if (typeof window !== "undefined") {
    const host = window.location.hostname || "";
    if (host === "methoaayupay.com" || host === "www.methoaayupay.com" || host.endsWith(".pages.dev")) {
      return "https://metho-backend.onrender.com";
    }
  }

  return "";
}

export function getBackendBaseUrlOrDefault(fallback = "http://localhost:8000") {
  return getBackendBaseUrl() || normalizeBase(fallback);
}

export function resolveAssetUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("http://")) {
      try {
        const parsed = new URL(url);
        const backendBase = getBackendBaseUrl();
        const backendHost = backendBase ? new URL(backendBase).host : "";
        const sameBackendHost = backendHost && parsed.host === backendHost;
        const renderHost = parsed.host.endsWith(".onrender.com");
        if (sameBackendHost || renderHost) {
          return `https://${url.slice("http://".length)}`;
        }
      } catch {
        // Fall through and return raw absolute URL on parse failure.
      }
    }
    return url;
  }
  if (url.startsWith("/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}${url}` : url;
  }
  // Legacy/compact API paths can arrive without a leading slash.
  if (url.startsWith("api/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}/${url}` : `/${url}`;
  }
  // Storage paths from older payloads should resolve through /api/files.
  if (url.startsWith("product_images/") || url.startsWith("payment_screenshots/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}/api/files/${url}` : `/api/files/${url}`;
  }
  if (url.startsWith("metho-aay-upay/product-images/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}/api/files/${url}` : `/api/files/${url}`;
  }
  if (url.startsWith("media/") || url.startsWith("uploads/") || url.startsWith("static/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}/${url}` : url;
  }
  return url;
}


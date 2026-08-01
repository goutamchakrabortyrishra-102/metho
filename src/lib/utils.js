import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const normalizeBase = (url) => String(url || "").trim().replace(/\/+$/, "");

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


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
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (url.startsWith("/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}${url}` : url;
  }
  if (url.startsWith("media/") || url.startsWith("uploads/") || url.startsWith("static/")) {
    const base = getBackendBaseUrl();
    return base ? `${base}/${url}` : url;
  }
  return url;
}


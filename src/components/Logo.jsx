import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSettings } from "@/contexts/SettingsContext";

const DEFAULT_LOGO_URL = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='200' height='200' rx='100' fill='%23e53935'/><text x='50%25' y='44%25' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='26' font-family='Arial, sans-serif' font-weight='700'>Metho</text><text x='50%25' y='62%25' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='17' font-family='Arial, sans-serif' font-weight='700'>STORE</text></svg>";
const LOGO_LOGISTICS_URL = "https://customer-assets-lxgj4vgw.emergentagent.net/job_metho-aay-upay/artifacts/o5mnsf6a_metho-logistics.png";
const LOGO_TAP_COUNT_KEY = "metho_logo_tap_count";
const LOGO_TAP_TS_KEY = "metho_logo_tap_ts";
const MAX_INLINE_LOGO_LENGTH = 40000;

const getSafeCustomLogoSrc = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.startsWith("data:") && normalized.length > MAX_INLINE_LOGO_LENGTH) {
    return "";
  }
  return normalized;
};

export const Logo = ({ className = "", showTagline = false, variant = "store", size = "md" }) => {
  const nav = useNavigate();
  const { settings } = useSettings();
  const rawCustomLogoSrc = String(settings?.site_logo_url_full || "").trim();
  const safeCustomLogoSrc = getSafeCustomLogoSrc(rawCustomLogoSrc);
  const rejectedOversizedInlineLogo = Boolean(rawCustomLogoSrc) && !safeCustomLogoSrc;
  const fallbackSrc = rejectedOversizedInlineLogo || variant === "logistics" ? LOGO_LOGISTICS_URL : DEFAULT_LOGO_URL;
  const hasCustomLogo = Boolean(safeCustomLogoSrc);
  const requestedSrc = safeCustomLogoSrc || fallbackSrc;
  const [imgSrc, setImgSrc] = React.useState(requestedSrc);
  const [retriedCustom, setRetriedCustom] = React.useState(false);

  React.useEffect(() => {
    setImgSrc(requestedSrc);
    setRetriedCustom(false);
  }, [requestedSrc]);
  const dim = size === "lg" ? "w-16 h-16" : size === "sm" ? "w-10 h-10" : "w-12 h-12";
  const badgeRadius = size === "lg" ? "rounded-[1.35rem]" : size === "sm" ? "rounded-[0.95rem]" : "rounded-[1.05rem]";
  const innerRadius = size === "lg" ? "rounded-[1.05rem]" : size === "sm" ? "rounded-[0.75rem]" : "rounded-[0.85rem]";
  const primaryText = size === "lg" ? "text-lg" : size === "sm" ? "text-[0.95rem]" : "text-[1.02rem]";
  const secondaryText = size === "lg" ? "text-[11px]" : size === "sm" ? "text-[9px]" : "text-[10px]";
  const taglineText = size === "lg" ? "text-[10px]" : "text-[8px]";
  const brandName = "METHO AAY-UPAY";
  const parts = String(brandName || "").trim().split(/\s+/).filter(Boolean);
  const primary = parts[0] || "METHO";
  const secondary = parts.slice(1).join(" ") || "AAY-UPAY";

  const onLogoClick = (e) => {
    const now = Date.now();
    let count = Number(localStorage.getItem(LOGO_TAP_COUNT_KEY) || 0);
    let ts = Number(localStorage.getItem(LOGO_TAP_TS_KEY) || 0);
    if (now - ts > 2200) count = 0;
    count += 1;
    localStorage.setItem(LOGO_TAP_COUNT_KEY, String(count));
    localStorage.setItem(LOGO_TAP_TS_KEY, String(now));
    if (count >= 5) {
      localStorage.removeItem(LOGO_TAP_COUNT_KEY);
      localStorage.removeItem(LOGO_TAP_TS_KEY);
      e.preventDefault();
      nav("/admin-login");
      return;
    }
  };

  return (
    <Link to="/" onClick={onLogoClick} className={`flex items-center gap-3 ${className}`} data-testid="brand-logo">
      <span className={`${dim} inline-flex items-center justify-center ${badgeRadius} bg-red-600 p-1.5 shadow-md ring-2 ring-white overflow-hidden shrink-0`}>
        <img
          src={imgSrc}
          alt={brandName}
          className={`h-full w-full ${innerRadius} object-contain bg-transparent`}
          onError={() => {
            if (hasCustomLogo && !retriedCustom) {
              setRetriedCustom(true);
              const isRetriableUrl =
                requestedSrc.startsWith("http://") ||
                requestedSrc.startsWith("https://") ||
                requestedSrc.startsWith("/") ||
                requestedSrc.startsWith("api/");
              if (isRetriableUrl) {
                const sep = requestedSrc.includes("?") ? "&" : "?";
                setImgSrc(`${requestedSrc}${sep}img_retry=${Date.now()}`);
                return;
              }
            }
            setImgSrc(fallbackSrc);
          }}
        />
      </span>
      <div className="flex min-w-0 flex-col justify-center leading-none">
        <span className={`font-display font-black ${primaryText} tracking-tight text-emerald-950 whitespace-nowrap`}>{primary}</span>
        <span className={`font-display font-semibold ${secondaryText} tracking-[0.18em] text-emerald-800 uppercase whitespace-nowrap`}>{secondary}</span>
        {showTagline && (
          <span className={`font-body ${taglineText} text-muted-foreground mt-0.5 truncate`}>Metho Logistics Private Limited</span>
        )}
      </div>
    </Link>
  );
};

export default Logo;


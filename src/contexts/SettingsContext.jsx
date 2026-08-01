import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/services/api";
import { resolveAssetUrl } from "@/lib/utils";

const SettingsContext = createContext({ settings: null, refresh: () => {} });
const invalidAssetKey = "metho_invalid_asset_urls";

const getInvalidAssetSet = () => {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(invalidAssetKey);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return new Set();
    return new Set(list.filter(Boolean));
  } catch {
    return new Set();
  }
};

const saveInvalidAssetSet = (setValue) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(invalidAssetKey, JSON.stringify(Array.from(setValue)));
  } catch {
    // Ignore storage failures and continue gracefully.
  }
};

const validateImageUrl = (url) => new Promise((resolve) => {
  const normalized = String(url || "").trim();
  if (!normalized) {
    resolve("");
    return;
  }
  if (typeof window === "undefined") {
    resolve(normalized);
    return;
  }
  const invalidSet = getInvalidAssetSet();
  if (invalidSet.has(normalized)) {
    resolve("");
    return;
  }

  const img = new Image();
  img.onload = () => resolve(normalized);
  img.onerror = () => {
    invalidSet.add(normalized);
    saveInvalidAssetSet(invalidSet);
    resolve("");
  };
  img.src = normalized;
});

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const r = await api.get("/settings");
      const s = r.data || {};
      // Resolve full URLs for brand assets so consumers can render directly
      s.site_logo_url_full = resolveAssetUrl(s.site_logo_url);
      s.landing_hero_image_url_full = resolveAssetUrl(s.landing_hero_image_url);
      s.directory_hero_image_url_full = await validateImageUrl(resolveAssetUrl(s.directory_hero_image_url));
      s.product_placeholder_image_url_full = resolveAssetUrl(s.product_placeholder_image_url);
      s.social_share_image_url_full = resolveAssetUrl(s.social_share_image_url);
      s.top_leader_1_image_url_full = resolveAssetUrl(s.top_leader_1_image_url);
      s.top_leader_2_image_url_full = resolveAssetUrl(s.top_leader_2_image_url);
      s.top_leader_3_image_url_full = resolveAssetUrl(s.top_leader_3_image_url);
      s.top_leader_4_image_url_full = resolveAssetUrl(s.top_leader_4_image_url);
      s.top_leader_5_image_url_full = resolveAssetUrl(s.top_leader_5_image_url);
      s.top_leader_6_image_url_full = resolveAssetUrl(s.top_leader_6_image_url);
      setSettings(s);
    } catch {
      // Keep previous settings on fetch failure.
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return <SettingsContext.Provider value={{ settings, refresh }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);


import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/services/api";
import { resolveAssetUrl } from "@/lib/utils";

const SettingsContext = createContext({ settings: null, refresh: () => {} });
const SETTINGS_CACHE_KEY = "metho_public_settings_cache_v1";
const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;

const readCachedSettings = () => {
  try {
    const cached = JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY) || "null");
    if (!cached || Date.now() - Number(cached.savedAt || 0) > SETTINGS_CACHE_TTL_MS) return null;
    return cached.settings && typeof cached.settings === "object" ? cached.settings : null;
  } catch {
    return null;
  }
};

const getCacheableSettings = (settings) => Object.fromEntries(
  Object.entries(settings || {}).filter(([, value]) => (
    typeof value !== "string" || !value.startsWith("data:") || value.length <= 64 * 1024
  ))
);

const writeCachedSettings = (settings) => {
  try {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), settings: getCacheableSettings(settings) }));
  } catch {
    // Ignore unavailable or full browser storage.
  }
};

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(readCachedSettings);
  const refresh = useCallback(async () => {
    const loadSettings = async () => {
      const candidates = ["/settings/public", "/settings"];
      let lastError = null;
      for (const path of candidates) {
        try {
          const r = await api.get(path);
          return r.data || {};
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error("settings fetch failed");
    };

    try {
      const s = await loadSettings();
      // Resolve full URLs for brand assets so consumers can render directly
      s.site_logo_url_full = resolveAssetUrl(s.site_logo_url);
      s.landing_hero_image_url_full = resolveAssetUrl(s.landing_hero_image_url);
      s.landing_tourism_banner_image_url_full = resolveAssetUrl(s.landing_tourism_banner_image_url);
      s.directory_hero_image_url_full = resolveAssetUrl(s.directory_hero_image_url);
      s.product_placeholder_image_url_full = resolveAssetUrl(s.product_placeholder_image_url);
      s.social_share_image_url_full = resolveAssetUrl(s.social_share_image_url);
      s.top_leader_1_image_url_full = resolveAssetUrl(s.top_leader_1_image_url);
      s.top_leader_2_image_url_full = resolveAssetUrl(s.top_leader_2_image_url);
      s.top_leader_3_image_url_full = resolveAssetUrl(s.top_leader_3_image_url);
      s.top_leader_4_image_url_full = resolveAssetUrl(s.top_leader_4_image_url);
      s.top_leader_5_image_url_full = resolveAssetUrl(s.top_leader_5_image_url);
      s.top_leader_6_image_url_full = resolveAssetUrl(s.top_leader_6_image_url);
      setSettings(s);
      writeCachedSettings(s);
    } catch {
      // Keep previous settings on fetch failure.
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return <SettingsContext.Provider value={{ settings, refresh }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);


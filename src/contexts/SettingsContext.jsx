import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/services/api";
import { resolveAssetUrl } from "@/lib/utils";

const SettingsContext = createContext({ settings: null, refresh: () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const refresh = useCallback(() => {
    api.get("/settings").then(r => {
      const s = r.data || {};
      // Resolve full URLs for brand assets so consumers can render directly
      s.site_logo_url_full = resolveAssetUrl(s.site_logo_url);
      s.landing_hero_image_url_full = resolveAssetUrl(s.landing_hero_image_url);
      s.directory_hero_image_url_full = resolveAssetUrl(s.directory_hero_image_url);
      s.product_placeholder_image_url_full = resolveAssetUrl(s.product_placeholder_image_url);
      s.social_share_image_url_full = resolveAssetUrl(s.social_share_image_url);
      s.top_leader_1_image_url_full = resolveAssetUrl(s.top_leader_1_image_url);
      s.top_leader_2_image_url_full = resolveAssetUrl(s.top_leader_2_image_url);
      s.top_leader_3_image_url_full = resolveAssetUrl(s.top_leader_3_image_url);
      setSettings(s);
    }).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return <SettingsContext.Provider value={{ settings, refresh }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);


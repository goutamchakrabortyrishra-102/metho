import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import InstallAppPrompt from "@/components/InstallAppPrompt";

const clearLegacyPwaState = async () => {
  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch (error) {}
  }

  if (window.caches && window.caches.keys) {
    try {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    } catch (error) {}
  }
};

const maybeClearLegacyPwaStateOnce = () => {
  if (typeof window === "undefined") return;
  const host = String(window.location.hostname || "").toLowerCase();
  const isHostedFrontend = host === "methoaayupay.com" || host === "www.methoaayupay.com" || host.endsWith(".pages.dev");
  const cleanupKey = "metho_legacy_pwa_cleanup_v4";

  // Hosted environments only need this cache eviction once per cleanup version.
  if (isHostedFrontend) {
    try {
      if (window.localStorage.getItem(cleanupKey) === "1") return;
      window.localStorage.setItem(cleanupKey, "1");
    } catch {
      // If localStorage fails, skip repeating the cleanup on every page load.
      return;
    }
    void clearLegacyPwaState();
    return;
  }

  try {
    if (window.localStorage.getItem(cleanupKey) === "1") return;
    window.localStorage.setItem(cleanupKey, "1");
  } catch {
    // Continue best-effort cleanup even if localStorage is unavailable.
  }
  void clearLegacyPwaState();
};

maybeClearLegacyPwaStateOnce();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <InstallAppPrompt />
    </QueryClientProvider>
  </React.StrictMode>,
);


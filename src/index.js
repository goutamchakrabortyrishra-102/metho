import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import InstallAppPrompt from "@/components/InstallAppPrompt";

const BootMarker = () => {
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      window.__methoAppMounted = true;
    }
  }, []);

  return null;
};

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

const installChunkLoadRecovery = () => {
  if (typeof window === "undefined") return;
  const recoveryKey = "metho_chunk_recovery_v1";
  const hasRecovered = () => {
    try {
      return window.sessionStorage.getItem(recoveryKey) === "1";
    } catch {
      return true;
    }
  };
  const markRecovered = () => {
    try {
      window.sessionStorage.setItem(recoveryKey, "1");
    } catch {}
  };

  const triggerRecoveryReload = () => {
    if (hasRecovered()) return;
    markRecovered();
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("_chunkfix", String(Date.now()));
    window.location.replace(nextUrl.toString());
  };

  const isChunkFailure = (raw) => {
    const msg = String(raw || "").toLowerCase();
    return (
      msg.includes("chunkloaderror") ||
      msg.includes("loading chunk") ||
      msg.includes("failed to fetch dynamically imported module") ||
      msg.includes("importing a module script failed")
    );
  };

  window.addEventListener("error", (event) => {
    const targetSrc = String(event?.target?.src || "");
    if (isChunkFailure(event?.message) || targetSrc.includes("/static/js/")) {
      triggerRecoveryReload();
    }
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const message = typeof reason === "string"
      ? reason
      : (reason?.message || reason?.toString?.() || "");
    if (isChunkFailure(message)) {
      triggerRecoveryReload();
    }
  });
};

installChunkLoadRecovery();

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
    <BootMarker />
    <QueryClientProvider client={queryClient}>
      <App />
      <InstallAppPrompt />
    </QueryClientProvider>
  </React.StrictMode>,
);


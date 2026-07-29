import React, { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const isStandaloneMode = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;

/**
 * InstallAppPrompt — floating pill button that triggers native PWA install prompt.
 * Shows only on eligible devices (Android Chrome / Edge / Samsung Internet). iOS shows an info tooltip.
 */
export default function InstallAppPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    setIsIOS(/iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua));
    const isStandalone = isStandaloneMode();
    if (isStandalone) { setDismissed(true); return; }
    if (localStorage.getItem("install-prompt-dismissed") === "1") { setDismissed(true); return; }

    const handler = (e) => {
      e.preventDefault();
      // Share prompt event globally so logo-tap can trigger one-touch install too.
      window.__methoInstallPrompt = e;
      setDeferred(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.__methoInstallPrompt = null;
    };
  }, []);

  const install = async () => {
    const promptEvent = deferred || window.__methoInstallPrompt;
    if (!promptEvent || isStandaloneMode()) return;
    promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === "accepted") {
      setDismissed(true);
      localStorage.setItem("install-prompt-dismissed", "1");
    }
    window.__methoInstallPrompt = null;
    setDeferred(null);
  };

  const dismiss = () => {
    localStorage.setItem("install-prompt-dismissed", "1");
    setDismissed(true);
  };

  if (dismissed) return null;
  if (!deferred && !isIOS) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-40 rounded-2xl bg-gradient-to-br from-emerald-950 to-emerald-900 text-white shadow-2xl border border-amber-400/30 p-4" data-testid="install-app-prompt">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-400 text-emerald-950 flex items-center justify-center shrink-0">
          <Download className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Install App</p>
          <p className="font-display font-bold text-sm mt-0.5">METHOO STORE on your home screen</p>
          {isIOS ? (
            <p className="text-xs text-emerald-100/80 mt-1 font-body">
              Tap <span className="font-bold">Share</span> → <span className="font-bold">Add to Home Screen</span>
            </p>
          ) : (
            <p className="text-xs text-emerald-100/80 mt-1 font-body">Faster access · Offline shell · Push-ready</p>
          )}
        </div>
        <button onClick={dismiss} className="text-emerald-100/60 hover:text-white" data-testid="install-dismiss">
          <X className="w-4 h-4" />
        </button>
      </div>
      {!isIOS && (
        <Button onClick={install} className="w-full mt-3 bg-amber-400 hover:bg-amber-500 text-emerald-950 rounded-full font-bold h-10" data-testid="install-app-button">
          <Download className="w-4 h-4 mr-2" /> Install Now — Free
        </Button>
      )}
    </div>
  );
}


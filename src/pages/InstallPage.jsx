import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Share2, Copy, CheckCircle2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";

const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;

export default function InstallPage() {
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    setIos(/iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua));
    setInstalled(isStandalone());
  }, []);

  const currentUrl = useMemo(() => {
    if (typeof window === "undefined") return "https://methoaayupay.com/install";
    return window.location.origin + "/install";
  }, []);

  const installNow = async () => {
    const promptEvent = window.__methoInstallPrompt;
    if (!promptEvent) {
      if (ios) {
        toast.info("On iPhone: tap Share, then Add to Home Screen");
      } else {
        toast.info("Install prompt not available yet. Open in Chrome and browse the site for a few seconds.");
      }
      return;
    }

    promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === "accepted") {
      localStorage.setItem("install-prompt-dismissed", "1");
      setInstalled(true);
      toast.success("App installed successfully");
    }
    window.__methoInstallPrompt = null;
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      toast.success("Install link copied");
    } catch {
      toast.error("Could not copy link");
    }
  };

  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "METHOO STORE App Install",
          text: "Install METHOO STORE on your phone",
          url: currentUrl,
        });
      } catch {}
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`Install METHOO STORE: ${currentUrl}`)}`, "_blank");
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(6,78,59,0.14),transparent_38%),linear-gradient(180deg,#f8fffd_0%,#effcf6_52%,#ecfdf5_100%)] px-4 py-8" data-testid="install-page">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center">
          <Logo />
          <Link to="/">
            <Button variant="outline" className="rounded-full">Home</Button>
          </Link>
        </div>

        <div className="mt-8 rounded-3xl border border-emerald-200 bg-white/95 shadow-xl p-6 md:p-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 text-emerald-900 px-3 py-1 text-xs font-semibold uppercase tracking-wider">
            <Smartphone className="w-3.5 h-3.5" /> App Install
          </div>

          <h1 className="mt-4 text-3xl md:text-4xl font-black text-emerald-950 leading-tight">
            Install METHOO STORE
          </h1>
          <p className="mt-2 text-slate-600">
            Share this page. Users can install like an app before Play Store launch.
          </p>

          <div className="mt-6 grid gap-3">
            <Button onClick={installNow} className="h-12 rounded-full bg-emerald-900 hover:bg-emerald-950 text-white font-semibold" data-testid="install-page-install-btn">
              <Download className="w-4 h-4 mr-2" /> Install Now
            </Button>

            <div className="grid grid-cols-2 gap-3">
              <Button onClick={shareLink} variant="outline" className="h-11 rounded-full" data-testid="install-page-share-btn">
                <Share2 className="w-4 h-4 mr-2" /> Share
              </Button>
              <Button onClick={copyLink} variant="outline" className="h-11 rounded-full" data-testid="install-page-copy-btn">
                <Copy className="w-4 h-4 mr-2" /> Copy Link
              </Button>
            </div>
          </div>

          <div className="mt-6 space-y-3 text-sm text-slate-700">
            <p><span className="font-semibold">Android:</span> Open in Chrome, tap Install Now.</p>
            <p><span className="font-semibold">iPhone:</span> Open Safari, then tap Share -&gt; Add to Home Screen.</p>
            <p><span className="font-semibold">Tip:</span> You can also open the install prompt by tapping the logo.</p>
          </div>

          {installed && (
            <div className="mt-6 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-900 flex items-center gap-2" data-testid="install-page-installed-msg">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-semibold">Installed. Open the app from the home screen icon.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

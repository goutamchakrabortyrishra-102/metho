import React, { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, HelpCircle, Phone, ShoppingCart, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const STORAGE_KEY = "metho_welcome_guide_seen_v1";

const slides = [
  {
    title: "Welcome to METHO AAY-UPAY",
    icon: HelpCircle,
    body: "METHO AAY-UPAY is a business, e-commerce, and service ecosystem for shopping, member services, partner opportunities, rider work, and support.",
  },
  {
    title: "Shop METHO Products",
    icon: ShoppingCart,
    body: "Browse products, add items to cart, enter delivery details, and complete checkout securely. METHO never asks for OTP, UPI PIN, ATM PIN, CVV, or passwords.",
  },
  {
    title: "Join Your Way",
    icon: Users,
    body: "You can join as a Member, Partner, or Rider. Members activate through qualifying purchases. Partners can list or promote business and services. Riders can join for delivery/work opportunities according to company rules.",
  },
  {
    title: "Need Help?",
    icon: Phone,
    body: "For accurate help, contact our Executive directly: 9339566110.",
  },
];

export default function WelcomeGuideModal() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const isAdminPath = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");

  useEffect(() => {
    if (isAdminPath || typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== "1") {
        setOpen(true);
      }
    } catch {
      setOpen(true);
    }
  }, [isAdminPath]);

  if (isAdminPath) return null;

  const slide = slides[index];
  const Icon = slide.icon;
  const isFirst = index === 0;
  const isLast = index === slides.length - 1;
  const openGuide = () => {
    setIndex(0);
    setOpen(true);
  };
  const finish = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={openGuide}
        className="fixed bottom-24 right-4 z-[45] inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-emerald-200 bg-white/95 px-3 text-xs font-bold text-emerald-900 shadow-lg backdrop-blur hover:bg-emerald-50"
        aria-label="Open welcome guide"
        data-testid="welcome-guide-help-button"
      >
        <HelpCircle className="h-4 w-4" />
        <span className="hidden sm:inline">Help</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md rounded-2xl border-emerald-200 bg-white p-0 overflow-hidden [&>button]:h-11 [&>button]:w-11 sm:[&>button]:h-auto sm:[&>button]:w-auto">
          <div className="bg-emerald-950 px-5 py-4 text-white">
            <DialogHeader>
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-400 text-emerald-950">
                <Icon className="h-6 w-6" />
              </div>
              <DialogTitle className="text-left font-display text-xl font-black leading-tight">
                {slide.title}
              </DialogTitle>
              <DialogDescription className="text-left text-xs font-semibold text-emerald-100">
                {index + 1} / {slides.length}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-5 px-5 pb-5 pt-4">
            <p className="text-sm leading-6 text-slate-700">{slide.body}</p>
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {slides.map((item, dotIndex) => (
                <span key={item.title} className={`h-1.5 rounded-full ${dotIndex === index ? "w-6 bg-emerald-800" : "w-1.5 bg-emerald-200"}`} />
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => setIndex((current) => Math.max(0, current - 1))} disabled={isFirst} className="h-11 rounded-full border-emerald-200 text-emerald-900">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              {isLast ? (
                <Button type="button" onClick={finish} className="h-11 rounded-full bg-emerald-900 px-5 text-white hover:bg-emerald-950">
                  Got it, Start Exploring
                </Button>
              ) : (
                <Button type="button" onClick={() => setIndex((current) => Math.min(slides.length - 1, current + 1))} className="h-11 rounded-full bg-emerald-900 px-5 text-white hover:bg-emerald-950">
                  Next <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

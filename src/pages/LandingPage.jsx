import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, TrendingUp, Users, Wallet, Shield, Award, Sparkles, Check, ChevronRight, Star, Building2, Zap, Globe, MapPin, Store, Search, Phone, PlayCircle, CalendarDays, Plane } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import UpiPaymentDialog from "@/components/UpiPaymentDialog";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/services/api";
import { methoStoreApi, normalizeCollection } from "@/services/methoStore";
import { useSettings } from "@/contexts/SettingsContext";
import { getGstInclusivePrice, resolveAssetUrl, getAssetImageFallbackCandidates } from "@/lib/utils";
import { isCompletePincode, normalizePincode } from "@/lib/indiaLocation";
import useDebouncedValue from "@/hooks/useDebouncedValue";

function ReferralEntryStrip() {
  const [params] = useSearchParams();
  const ref = (params.get("ref") || "").trim().toUpperCase();

  useEffect(() => {
    if (!ref) return;
    try {
      localStorage.setItem("metho_ref_code", ref);
    } catch {}
  }, [ref]);

  if (!ref) return null;

  return (
    <section className="pt-24 pb-4 px-6" data-testid="landing-referral-entry-strip">
      <div className="max-w-7xl mx-auto rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-50 to-emerald-50 p-4 md:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">Referral Link Opened</p>
          <p className="text-sm md:text-base text-emerald-950 font-semibold mt-1">
            Sponsor code <span className="font-mono">{ref}</span> saved. You can join now, or continue in Guest mode.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/register?ref=${encodeURIComponent(ref)}`} data-testid="landing-ref-join">
            <Button className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full">
              Join Now <ArrowRight className="ml-1 w-4 h-4" />
            </Button>
          </Link>
          <Link to={`/shop?ref=${encodeURIComponent(ref)}`} data-testid="landing-ref-guest">
            <Button variant="outline" className="rounded-full border-emerald-900/20 hover:bg-emerald-50 hover:text-emerald-900">
              Continue as Guest
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

const DEFAULT_HERO_IMG = "https://images.pexels.com/photos/7413999/pexels-photo-7413999.jpeg?auto=compress&cs=tinysrgb&w=1400";
const NETWORK_IMG = "https://images.pexels.com/photos/7581110/pexels-photo-7581110.jpeg?auto=compress&cs=tinysrgb&w=1400";
const TEAM_IMG = "https://images.pexels.com/photos/7580944/pexels-photo-7580944.jpeg?auto=compress&cs=tinysrgb&w=500";
const WALLET_IMG = "https://images.pexels.com/photos/7580855/pexels-photo-7580855.jpeg?auto=compress&cs=tinysrgb&w=500";
const FALLBACK_PRODUCT_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'><rect width='600' height='600' fill='%23f1f5f9'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23475569' font-size='26' font-family='Arial'>METHO Product</text></svg>";
const FALLBACK_LEADER_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 700 875'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0%25' stop-color='%23f8fafc'/><stop offset='100%25' stop-color='%23e2e8f0'/></linearGradient></defs><rect width='700' height='875' fill='url(%23g)'/><circle cx='350' cy='305' r='104' fill='%2394a3b8' opacity='0.42'/><rect x='170' y='430' width='360' height='280' rx='180' fill='%2394a3b8' opacity='0.35'/><rect x='0' y='760' width='700' height='115' fill='%23cbd5e1' opacity='0.4'/></svg>";
const pickProductImageSrc = (product) => resolveAssetUrl(
  product?.image_url ||
  product?.product_image_url ||
  product?.image ||
  product?.thumbnail_url ||
  product?.thumb_url ||
  product?.photo_url ||
  ""
);

const applyLandingImageFallback = (event, extras = [], terminalFallback = FALLBACK_PRODUCT_IMG) => {
  const target = event.currentTarget;
  const candidates = getAssetImageFallbackCandidates(target.src, [...extras, terminalFallback]);
  const tried = Number(target.dataset.fallbackIndex || "0");
  for (let i = tried; i < candidates.length; i += 1) {
    const next = String(candidates[i] || "").trim();
    if (!next || next === target.src) continue;
    target.dataset.fallbackIndex = String(i + 1);
    target.src = next;
    return;
  }
  if (target.src !== terminalFallback) target.src = terminalFallback;
};

const isVisibleMethoProduct = (product) => {
  const typeOk = String(product?.product_type || "metho").toLowerCase() === "metho";
  const hiddenRaw = product?.hidden;
  const isHidden = hiddenRaw === true || String(hiddenRaw).toLowerCase() === "true" || String(hiddenRaw) === "1";
  return typeOk && !isHidden;
};

const mixProductsByCategory = (products, limit = 6) => {
  const groups = new Map();
  (products || []).forEach((product) => {
    const category = String(product?.category || "General");
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(product);
  });
  const mixed = [];
  while (mixed.length < limit) {
    let added = false;
    for (const group of groups.values()) {
      const next = group.shift();
      if (!next) continue;
      mixed.push(next);
      added = true;
      if (mixed.length >= limit) break;
    }
    if (!added) break;
  }
  return mixed;
};

const normalizeYoutubeUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(www\.)?youtube\.com\//i.test(raw) || /^youtu\.be\//i.test(raw)) return `https://${raw}`;
  return "";
};

const normalizeFacebookUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(www\.)?facebook\.com\//i.test(raw) || /^fb\.com\//i.test(raw)) return `https://${raw}`;
  return "";
};
const DEFAULT_POLICY = {
  mission_statement: "To build a trusted, product-driven smart earning ecosystem that delivers fair and sustainable income opportunities for everyone.",
  vision_statement: "Our vision is to empower marginalized people, transform small businesses from local to global, and build sustainable financial freedom with a special focus on women.",
  return_policy:
    "1. Return requests for defective, damaged, or incorrect products can be raised within 7 days of delivery.\n" +
    "2. Used, tampered, or physically damaged products are not eligible for return unless covered by an approved exception.\n" +
    "3. Approved returns are processed for refund or replacement within the committed service timeline.",
};

let landingProductsPromise = null;

const LANDING_CART_STORAGE_KEY = "metho_shared_cart_v1";
const getProductStock = (product) => Math.max(0, Number(product?.stock ?? 0));
const getCustomerUnitPrice = (product) => {
  const productType = String(product?.product_type || "metho").toLowerCase();
  const gstPercent = productType === "metho" ? Number(product?.gst_percent || 0) : 0;
  return getGstInclusivePrice(product?.price, gstPercent);
};

const useSectionActivation = (rootMargin = "240px 0px") => {
  const sectionRef = useRef(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (isActive) return;
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setIsActive(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsActive(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isActive, rootMargin]);

  return [sectionRef, isActive];
};

const fetchPublicStartupProducts = async (limit = 48) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 48, 48));
  const candidates = [
    `/products/public?limit=${safeLimit}`,
    `/products?limit=${safeLimit}&compact=1`,
    `/products?limit=${safeLimit}`,
    "/products",
  ];
  let lastError = null;
  for (const path of candidates) {
    try {
      const r = await api.get(path);
      return normalizeCollection(r.data);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("products fetch failed");
};

const loadLandingProducts = async () => {
  if (!landingProductsPromise) {
    landingProductsPromise = fetchPublicStartupProducts(48).catch((err) => {
      landingProductsPromise = null;
      throw err;
    });
  }
  return landingProductsPromise;
};

const getProductVideoUrl = (product) => normalizeYoutubeUrl(
  product?.youtube_url ||
  product?.youtubeUrl ||
  product?.video_url ||
  product?.videoUrl ||
  ""
);

const normalizeCategoryOrder = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.includes("|")
      ? value.split("|").map((item) => item.trim()).filter(Boolean)
      : value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const Nav = () => (
  <header className="fixed top-0 left-0 right-0 z-50 glass" data-testid="landing-nav">
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-3.5 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="hidden sm:block"><Logo showTagline /></div>
        <div className="sm:hidden"><Logo /></div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href="tel:+917003805387"
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white/90 px-2 sm:px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-50"
            aria-label="Call METHO at +91 7003805387"
            data-testid="nav-call-link"
          >
            <Phone className="w-3.5 h-3.5" /> <span className="whitespace-nowrap">Call Us Anytime</span>
          </a>
          <Link to="/login" data-testid="nav-login-link"><Button variant="ghost" size="sm" className="px-3 md:px-4 hover:bg-emerald-50 hover:text-emerald-900">Login</Button></Link>
          <Link to="/register" data-testid="nav-register-link">
            <Button size="sm" className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-4 md:px-5">Join Now <ArrowRight className="ml-1 w-4 h-4" /></Button>
          </Link>
        </div>
      </div>

      <nav className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 text-xs font-body xl:hidden" aria-label="Primary mobile navigation">
        <a href="#features" className="shrink-0 rounded-full border border-emerald-900/10 bg-white/90 px-3 py-1.5 text-slate-700 hover:text-emerald-900">Features</a>
        <a href="#plan" className="shrink-0 rounded-full border border-emerald-900/10 bg-white/90 px-3 py-1.5 text-slate-700 hover:text-emerald-900">Growth Plan</a>
        <a href="#partner-finder" className="shrink-0 rounded-full border border-emerald-900/10 bg-white/90 px-3 py-1.5 text-slate-700 hover:text-emerald-900">Partner Finder</a>
        <a href="#products" className="shrink-0 rounded-full border border-emerald-900/10 bg-white/90 px-3 py-1.5 text-slate-700 hover:text-emerald-900">Products</a>
        <a href="#return-policy" className="shrink-0 rounded-full border border-emerald-900/10 bg-white/90 px-3 py-1.5 text-slate-700 hover:text-emerald-900">Return Policy</a>
        <Link to="/partner-register" className="shrink-0 rounded-full border border-emerald-900/10 bg-white/90 px-3 py-1.5 text-slate-700 hover:text-emerald-900">Partner Register</Link>
        <Link to="/directory" className="shrink-0 rounded-full border border-emerald-900/10 bg-white/90 px-3 py-1.5 text-slate-700 hover:text-emerald-900">Partner Shop</Link>
        <Link to="/metho-store" className="shrink-0 rounded-full border border-emerald-900/10 bg-white/90 px-3 py-1.5 text-slate-700 hover:text-emerald-900">View Metho Store</Link>
        <Link to="/login" className="shrink-0 rounded-full border border-emerald-900/10 bg-white/90 px-3 py-1.5 text-slate-700 hover:text-emerald-900">Partner Login</Link>
        <Link to="/login?next=/app/metho-store-owner" className="shrink-0 rounded-full border border-emerald-900/10 bg-white/90 px-3 py-1.5 text-slate-700 hover:text-emerald-900">Store Login</Link>
      </nav>

      <nav className="hidden xl:flex items-center gap-6 font-body text-sm">
        <a href="#features" className="text-slate-700 hover:text-emerald-900 transition-colors">Features</a>
        <a href="#plan" className="text-slate-700 hover:text-emerald-900 transition-colors">Growth Plan</a>
        <a href="#partner-finder" className="text-slate-700 hover:text-emerald-900 transition-colors">Partner Finder</a>
        <a href="#products" className="text-slate-700 hover:text-emerald-900 transition-colors">Products</a>
        <a href="#return-policy" className="text-slate-700 hover:text-emerald-900 transition-colors">Return Policy</a>
      </nav>
      <div className="hidden lg:flex items-center gap-2 shrink-0">
        <Link to="/partner-register" className="inline-flex" data-testid="nav-partner-register-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">Partner Register</Button>
        </Link>
        <Link to="/directory" className="inline-flex" data-testid="nav-partner-shop-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">Partner Shop</Button>
        </Link>
        <Link to="/metho-store" className="md:inline-flex" data-testid="nav-metho-store-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">View Metho Store</Button>
        </Link>
        <Link to="/login" className="inline-flex" data-testid="nav-partner-login-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">Partner Login</Button>
        </Link>
        <Link to="/login?next=/app/metho-store-owner" className="inline-flex" data-testid="nav-store-login-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">Store Login</Button>
        </Link>
      </div>
    </div>
  </header>
);

const Hero = () => {
  const { settings } = useSettings();
  const { user } = useAuth();
  const nav = useNavigate();
  const [shopSearch, setShopSearch] = useState("");
  const [bestProducts, setBestProducts] = useState([]);
  const [cartQty, setCartQty] = useState({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [guestMemberRef, setGuestMemberRef] = useState("");
  const cartHydratedRef = useRef(false);
  const hasBestProducts = bestProducts.length > 0;
  const LANDING_TOP_PRODUCTS_LIMIT = 10;
  const flowStats = [
    { label: "Live Partner Network", value: "Pan-India" },
    { label: "Member Onboarding", value: "60 Sec" },
    { label: "Store + Directory", value: "Unified" },
    { label: "Operations", value: "Real-Time" },
  ];
  const HERO_IMG = settings?.landing_hero_image_url_full || DEFAULT_HERO_IMG;
  const tagline = settings?.landing_tagline;
  const companyVideoUrl = normalizeYoutubeUrl(settings?.company_youtube_url);

  useEffect(() => {
    let active = true;
    loadLandingProducts()
      .then((rows) => {
        if (!active) return;
        const visibleProducts = rows.filter(isVisibleMethoProduct);
        setBestProducts(visibleProducts);
      })
      .catch(() => {
        if (active) setBestProducts([]);
      });

    return () => {
      active = false;
    };
  }, []);

  const openShopWithSearch = () => {
    const q = String(shopSearch || "").trim();
    if (!q) {
      nav("/shop");
      return;
    }
    nav(`/shop?q=${encodeURIComponent(q)}`);
  };

  useEffect(() => {
    if (cartHydratedRef.current) return;
    cartHydratedRef.current = true;
    try {
      const raw = localStorage.getItem(LANDING_CART_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") setCartQty(parsed);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (Object.keys(cartQty).length > 0) {
        localStorage.setItem(LANDING_CART_STORAGE_KEY, JSON.stringify(cartQty));
      } else {
        localStorage.removeItem(LANDING_CART_STORAGE_KEY);
      }
    } catch {}
  }, [cartQty]);

  const adjustCartQty = (product, delta) => {
    const id = String(product?.id || "");
    if (!id) return;
    setCartQty((prev) => {
      const stock = getProductStock(product);
      const current = prev[id] || 0;
      let next = current + delta;
      if (stock > 0) next = Math.min(next, stock);
      next = Math.max(0, next);
      if (next === current) return prev;
      const copy = { ...prev };
      if (next <= 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  };

  const groupedBestProducts = useMemo(() => {
    const order = [];
    const map = new Map();
    bestProducts.forEach((product) => {
      const category = String(product?.category || "").trim() || "METHO Products";
      if (!map.has(category)) {
        map.set(category, []);
        order.push(category);
      }
      map.get(category).push(product);
    });
    const adminOrder = normalizeCategoryOrder(settings?.product_categories);
    const ranked = [
      ...adminOrder.filter((category) => map.has(category)),
      ...order.filter((category) => !adminOrder.includes(category)),
    ];
    return ranked.map((category) => ({ category, items: map.get(category) }));
  }, [bestProducts, settings?.product_categories]);

  const cartItemCount = useMemo(
    () => Object.values(cartQty).reduce((sum, qty) => sum + (Number(qty) || 0), 0),
    [cartQty]
  );

  const cartSubtotal = useMemo(() => {
    const byId = new Map(bestProducts.map((product) => [String(product?.id || ""), product]));
    return Object.entries(cartQty).reduce((sum, [id, qty]) => {
      const product = byId.get(id);
      const price = getCustomerUnitPrice(product);
      return sum + price * (Number(qty) || 0);
    }, 0);
  }, [cartQty, bestProducts]);

  const checkoutItems = useMemo(() => {
    const byId = new Map(bestProducts.map((product) => [String(product?.id || ""), product]));
    return Object.entries(cartQty)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([id, qty]) => {
        const product = byId.get(id);
        if (!product) return null;
        const price = getCustomerUnitPrice(product);
        if (price <= 0) return null;
        return {
          id,
          name: product?.name,
          price,
          quantity: Number(qty) || 0,
          subtotal: Number((price * (Number(qty) || 0)).toFixed(2)),
          image_url: product?.image_url || "",
          category: product?.category || "",
          delivery_category: product?.category || "",
          delivery_charge: Number(product?.delivery_charge || 0),
          free_delivery_threshold: Number(product?.free_delivery_threshold || 0),
        };
      })
      .filter(Boolean);
  }, [cartQty, bestProducts]);

  const checkoutTotal = useMemo(
    () => checkoutItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0),
    [checkoutItems]
  );

  const adjustCheckoutItemQty = (item, delta) => {
    const product = bestProducts.find((p) => String(p?.id || "") === String(item?.id || ""));
    if (!product) return;
    adjustCartQty(product, delta);
  };

  const onSearchKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      openShopWithSearch();
    }
  };

  return (
  <section className="relative pt-32 pb-14 overflow-hidden bg-[radial-gradient(circle_at_12%_6%,rgba(245,158,11,0.14),transparent_28%),radial-gradient(circle_at_84%_10%,rgba(16,185,129,0.08),transparent_34%),linear-gradient(180deg,#fffefb_0%,#f9fbfa_44%,#f2f7f5_100%)]">
    <div className="absolute inset-0 grain" />
    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808] opacity-80" />
    <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-[28rem] h-[28rem] bg-amber-300/15 rounded-full blur-3xl" />
    <div className="absolute right-0 top-24 w-72 h-72 bg-emerald-900/6 rounded-full blur-3xl" />
    <div className="max-w-7xl mx-auto px-6 relative">
      <div className="grid lg:grid-cols-12 gap-8 items-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="lg:col-span-7">
          <div className="mt-6 flex items-start justify-between gap-5">
            <div className="min-w-0">
              {tagline ? (
                <h1 className="font-display font-black text-4xl md:text-5xl lg:text-6xl tracking-tight leading-[0.97] text-emerald-950">
                  {tagline}
                </h1>
              ) : (
                <h1 className="font-display font-black text-4xl md:text-5xl lg:text-6xl tracking-tight leading-[0.97] text-emerald-950">
                  Real Business. Real Rewards. Real Growth.
                  <span className="mt-4 block text-xl md:text-2xl lg:text-[2rem] font-bold text-amber-600 italic leading-tight">METHO AAY-UPAY — Smart Commerce for customer, Members &amp; Partners.</span>
                </h1>
              )}
            </div>
            <Link to="/partner-shop/MTH-PARTNER-004" className="hidden lg:inline-flex shrink-0 mt-2" data-testid="landing-highlight-vegetables">
              <Button size="lg" className="rounded-full bg-red-600 hover:bg-red-700 text-white font-bold px-7 h-14 text-base shadow-[0_16px_34px_rgba(185,28,28,0.22)]">
                Open METHO Vegetable
              </Button>
            </Link>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <p className="inline-flex items-center rounded-full border border-emerald-200 bg-white/95 px-4 py-2 text-sm font-semibold tracking-wide text-emerald-900 shadow-sm">
              Powered By Metho Logistics Private Limited
            </p>
            <Link to="/partner-shop/MTH-PARTNER-004" className="inline-flex lg:hidden" data-testid="landing-highlight-vegetables-mobile">
              <Button size="lg" className="rounded-full bg-red-600 hover:bg-red-700 text-white font-bold px-7 h-14 text-base shadow-[0_16px_34px_rgba(185,28,28,0.22)]">
                Open METHO Vegetable
              </Button>
            </Link>
          </div>
          <div className="mt-8 rounded-[2rem] border border-emerald-900/12 bg-white/90 p-3 shadow-[0_18px_42px_rgba(15,23,42,0.08)] md:p-4" data-testid="hero-direct-access-card">
            <div className="flex flex-wrap items-center gap-3 rounded-[1.5rem] border border-emerald-900/10 bg-gradient-to-r from-white via-emerald-50/75 to-white p-2.5">
            <Link to="/shop" className="w-full sm:w-auto" data-testid="hero-cta-shop">
              <Button size="lg" variant="outline" className="rounded-full px-7 h-12 text-base border-emerald-900/20 bg-white/95 shadow-sm hover:bg-emerald-50 hover:text-emerald-900 w-full sm:w-auto">
                Browse METHO Products <ChevronRight className="ml-1 w-4 h-4" />
              </Button>
            </Link>
            <div className="w-full sm:w-auto flex items-center gap-2" data-testid="hero-shop-search-wrap">
              <div className="relative w-full sm:w-[270px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={shopSearch}
                  onChange={(e) => setShopSearch(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Search METHO products"
                  className="pl-9 h-12 rounded-full border-emerald-900/25 bg-emerald-100/90 shadow-sm"
                  data-testid="hero-shop-search-input"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-full border-emerald-900/25 bg-emerald-100 text-emerald-900 shadow-sm hover:bg-emerald-200 hover:text-emerald-950"
                onClick={openShopWithSearch}
                data-testid="hero-shop-search-button"
              >
                <Search className="w-4 h-4" />
              </Button>
            </div>
          </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2" data-testid="hero-commerce-focus-cards">
              <Link to="/shop" className="group rounded-2xl border border-emerald-900/12 bg-white/92 px-4 py-3.5 shadow-sm hover:shadow-md hover:border-emerald-900/20 transition-all" data-testid="hero-focus-metho-products">
                <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.22em] text-emerald-800 font-semibold">METHO Product</p><p className="mt-1 font-display font-black text-lg text-emerald-950 leading-tight">Fast moving catalog</p><p className="mt-1 text-xs text-slate-600">Category-ready browsing with direct shop access.</p></div><div className="w-10 h-10 rounded-xl border border-emerald-200 bg-emerald-50 flex items-center justify-center text-emerald-900 group-hover:bg-emerald-100 transition-colors"><Store className="w-5 h-5" /></div></div>
              </Link>
              <Link to="/directory" className="group rounded-2xl border border-emerald-900/12 bg-white/92 px-4 py-3.5 shadow-sm hover:shadow-md hover:border-emerald-900/20 transition-all" data-testid="hero-focus-partner-shop">
                <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.22em] text-emerald-800 font-semibold">Partner Shop</p><p className="mt-1 font-display font-black text-lg text-emerald-950 leading-tight">Verified local partners</p><p className="mt-1 text-xs text-slate-600">Find services by city, category, and business type.</p></div><div className="w-10 h-10 rounded-xl border border-emerald-200 bg-emerald-50 flex items-center justify-center text-emerald-900 group-hover:bg-emerald-100 transition-colors"><MapPin className="w-5 h-5" /></div></div>
              </Link>
            </div>
            <div className="mt-4 rounded-2xl border border-emerald-700/40 bg-gradient-to-r from-emerald-900 via-emerald-800 to-emerald-900 p-3.5 text-white" data-testid="hero-sector-quick-access">
              <div className="flex items-center justify-between gap-2 flex-wrap"><p className="text-[10px] uppercase tracking-[0.2em] text-emerald-100 font-semibold">Member / Customer Direct Sector Access</p><span className="text-[10px] text-emerald-100/80">One tap to browse</span></div>
              <div className="mt-3 grid gap-3 lg:grid-cols-12">
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 lg:col-span-7">
                  <Link to="/directory?quick=products" className="group" data-testid="hero-sector-products"><div className="rounded-xl border border-emerald-200/35 bg-white/95 text-emerald-950 px-3 py-2.5 hover:bg-emerald-50 transition-colors"><p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">Sector</p><p className="text-sm font-bold mt-0.5">All Products</p></div></Link>
                  <Link to="/directory?quick=transport" className="group" data-testid="hero-sector-transport"><div className="rounded-xl border border-emerald-200/35 bg-white/95 text-emerald-950 px-3 py-2.5 hover:bg-emerald-50 transition-colors"><p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">Sector</p><p className="text-sm font-bold mt-0.5">Transport</p></div></Link>
                  <Link to="/directory?quick=stay-dining" className="group" data-testid="hero-sector-stay-dining"><div className="rounded-xl border border-emerald-200/35 bg-white/95 text-emerald-950 px-3 py-2.5 hover:bg-emerald-50 transition-colors"><p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">Sector</p><p className="text-sm font-bold mt-0.5">Stay &amp; Dining</p></div></Link>
                  <Link to="/directory?quick=doorstep" className="group" data-testid="hero-sector-doorstep"><div className="rounded-xl border border-emerald-200/35 bg-white/95 text-emerald-950 px-3 py-2.5 hover:bg-emerald-50 transition-colors"><p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">Sector</p><p className="text-sm font-bold mt-0.5">Doorstep</p></div></Link>
                  <Link to="/directory?quick=other-services" className="group" data-testid="hero-sector-other-services"><div className="rounded-xl border border-emerald-200/35 bg-white/95 text-emerald-950 px-3 py-2.5 hover:bg-emerald-50 transition-colors"><p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">Sector</p><p className="text-sm font-bold mt-0.5">Other Services</p></div></Link>
                </div>
                <div className="lg:col-span-5 rounded-xl border border-emerald-200/35 bg-white/95 text-emerald-950 px-3 py-2.5" data-testid="hero-product-subsectors"><div className="flex items-center justify-between gap-2"><p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">Product Sectors</p><span className="text-[10px] text-slate-500">4 parts</span></div><div className="mt-2 grid grid-cols-2 gap-2"><Link to="/partner-shop/MTH-PARTNER-004" className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-2 text-sm font-semibold hover:bg-emerald-100 transition-colors" data-testid="hero-product-vegetables">Vegetables</Link><Link to="/directory?quick=grocery" className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-2 text-sm font-semibold hover:bg-emerald-100 transition-colors" data-testid="hero-product-grocery">Grocery</Link><Link to="/directory?quick=cosmetics-beauty" className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-2 text-sm font-semibold hover:bg-emerald-100 transition-colors" data-testid="hero-product-cosmetics-beauty">Cosmetics &amp; Beauty</Link><Link to="/directory?quick=others" className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-2 text-sm font-semibold hover:bg-emerald-100 transition-colors" data-testid="hero-product-others">Others</Link></div></div>
              </div>
            </div>
          </div>
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-2.5" data-testid="hero-rating-stars">
            {flowStats.map((item) => (
              <div key={item.label} className="rounded-xl border border-emerald-900/10 bg-white/80 px-3 py-2.5 shadow-sm">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{item.label}</p>
                <p className="mt-1 text-sm font-bold text-emerald-950">{item.value}</p>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.2 }} className="lg:col-span-5 relative">
          <div className="relative">
            <div className="absolute -top-4 -left-4 w-28 h-28 bg-amber-300/30 rounded-full blur-3xl" />
            <div className="absolute -bottom-4 -right-4 w-40 h-40 bg-emerald-500/15 rounded-full blur-3xl" />
            <div className="absolute -left-3 top-10 bottom-10 w-1.5 rounded-full bg-gradient-to-b from-[#ff9933] via-white to-[#138808]" />
            <div className="relative rounded-[28px] overflow-hidden shadow-xl border border-emerald-900/10 bg-white p-2.5">
              <div className="relative rounded-[22px] overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950">
                <img
                  src={NETWORK_IMG}
                  alt="Associate partner network"
                  className="absolute inset-0 w-full h-full object-cover opacity-12"
                  loading="lazy"
                  decoding="async"
                  fetchPriority="low"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950" />

                <div className="relative z-10 p-4 md:p-5 flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="max-w-[78%]">
                      <p className="text-[9px] uppercase tracking-[0.3em] text-amber-300 font-bold">Quick Access</p>
                      <p className="mt-1 font-display text-xl font-black text-white">METHO direct access</p>
                    </div>
                    <div className="rounded-2xl bg-white/10 border border-white/15 p-2.5 md:p-3 text-white shrink-0 backdrop-blur-sm">
                      <Building2 className="w-5 h-5 md:w-6 md:h-6" />
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      {
                        title: "Member Registration",
                        href: "/register",
                        icon: Users,
                        testId: "landing-quick-member-registration",
                      },
                      {
                        title: "Partner Registration",
                        href: "/partner-register",
                        icon: Building2,
                        testId: "landing-quick-partner-registration",
                      },
                      {
                        title: "View All Products",
                        href: "/shop",
                        icon: Store,
                        testId: "landing-quick-view-all-products",
                      },
                      {
                        title: "Tour & Travel",
                        href: "/shop?q=travel",
                        icon: Plane,
                        testId: "landing-quick-tour-travel",
                      },
                      {
                        title: "View All Partners/Services",
                        href: "/directory",
                        icon: Globe,
                        testId: "landing-quick-view-all-partners-services",
                      },
                      {
                        title: "Customer Order History",
                        href: "/customer-orders",
                        icon: Shield,
                        testId: "landing-quick-customer-order-history",
                      },
                      {
                        title: "Partner Login",
                        href: "/login",
                        icon: Building2,
                        testId: "landing-quick-partner-login",
                      },
                      {
                        title: "Store Login",
                        href: "/login?next=/app/metho-store-owner",
                        icon: Store,
                        testId: "landing-quick-store-login",
                      },
                      {
                        title: "Member Login",
                        href: "/login",
                        icon: Users,
                        testId: "landing-quick-member-login",
                      },
                    ].map((item) => (
                      <Link
                        key={item.title}
                        to={item.href}
                        className="group rounded-xl bg-white/95 border border-emerald-100/30 px-3.5 py-2.5 text-emerald-950 shadow-sm hover:bg-emerald-50 hover:border-amber-200/70 transition-colors"
                        data-testid={item.testId}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-display font-bold text-sm leading-tight tracking-tight">{item.title}</p>
                          <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-900 group-hover:bg-emerald-100 transition-colors shrink-0">
                            <item.icon className="w-4 h-4" />
                          </div>
                        </div>
                      </Link>
                    ))}

                    {companyVideoUrl ? (
                      <a
                        href={companyVideoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="group rounded-xl bg-white/95 border border-emerald-100/30 px-3.5 py-2.5 text-emerald-950 shadow-sm hover:bg-emerald-50 hover:border-amber-200/70 transition-colors sm:col-span-2"
                        data-testid="landing-quick-watch-video"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-display font-bold text-sm leading-tight tracking-tight">Watch VDO</p>
                          <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-900 group-hover:bg-emerald-100 transition-colors shrink-0">
                            <PlayCircle className="w-4 h-4" />
                          </div>
                        </div>
                      </a>
                    ) : (
                      <Link
                        to="/shop"
                        className="group rounded-xl bg-white/95 border border-emerald-100/30 px-3.5 py-2.5 text-emerald-950 shadow-sm hover:bg-emerald-50 hover:border-amber-200/70 transition-colors sm:col-span-2"
                        data-testid="landing-quick-watch-video"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-display font-bold text-sm leading-tight tracking-tight">Watch VDO</p>
                          <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-900 group-hover:bg-emerald-100 transition-colors shrink-0">
                            <PlayCircle className="w-4 h-4" />
                          </div>
                        </div>
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Rendered outside the backdrop-blur product panel so `fixed` positions relative to the viewport, not the panel */}
      {cartItemCount > 0 && !checkoutOpen ? (
        <div className="fixed bottom-4 md:bottom-auto md:top-[14.5rem] left-1/2 z-[60] w-[min(680px,calc(100vw-1.5rem))] -translate-x-1/2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-900/20 bg-emerald-950 px-4 py-3 text-white shadow-lg" data-testid="hero-best-products-cart-summary-top">
          <p className="text-sm font-semibold">
            Cart: {cartItemCount} item(s){cartSubtotal > 0 ? ` · ₹${cartSubtotal.toLocaleString("en-IN")}` : ""}
          </p>
          <Button
            onClick={() => setCheckoutOpen(true)}
            className="bg-amber-400 hover:bg-amber-300 text-emerald-950 rounded-full px-5 font-bold"
            data-testid="hero-best-products-checkout-top"
          >
            Checkout <ArrowRight className="ml-1 w-4 h-4" />
          </Button>
        </div>
      ) : null}

      <div id="products" className="mt-12 rounded-[2rem] border border-emerald-900/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(240,251,246,0.95)_100%)] backdrop-blur p-4 md:p-6 shadow-[0_20px_44px_rgba(15,23,42,0.1)]" data-testid="hero-best-products-grid">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-emerald-800 font-semibold">METHO Best Products</p>
            <h3 className="font-display font-black text-xl md:text-2xl text-emerald-950">{hasBestProducts ? "Top product images from admin uploads" : "Live products will appear here after upload"}</h3>
          </div>
          <Link to="/shop" data-testid="hero-best-products-view-all" className="hidden md:inline-flex">
            <Button variant="outline" className="rounded-full border-emerald-900/20 hover:bg-emerald-50 hover:text-emerald-900">
              View All Products <ChevronRight className="ml-1 w-4 h-4" />
            </Button>
          </Link>
        </div>
        <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
          {[
            "High-visibility products",
            "Direct product search",
            "Corporate-ready listing",
          ].map((pill) => (
            <span key={pill} className="rounded-full border border-emerald-900/12 bg-white px-3 py-1 text-emerald-900 font-semibold">{pill}</span>
          ))}
        </div>

        <div className="space-y-6">
          {(hasBestProducts ? groupedBestProducts : [{ category: "METHO Products", items: Array.from({ length: LANDING_TOP_PRODUCTS_LIMIT }) }]).map((group) => (
            <div key={group.category}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 mb-2">{group.category}</p>
              <div
                className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory"
                data-testid={`hero-best-products-row-${String(group.category).toLowerCase().replace(/\s+/g, "-")}`}
              >
                {group.items.map((p, i) => {
                  const id = String(p?.id || "");
                  const qty = cartQty[id] || 0;
                  const outOfStock = id ? getProductStock(p) <= 0 : false;
                  const videoUrl = getProductVideoUrl(p);
                  return (
                    <div
                      key={id || i}
                      className="w-[210px] sm:w-[230px] shrink-0 snap-start bg-white rounded-xl overflow-hidden border border-slate-200 hover:shadow-lg transition-all"
                      data-testid={`hero-best-product-${i + 1}`}
                    >
                      <div className="aspect-square overflow-hidden bg-slate-100 relative">
                        <img
                          src={pickProductImageSrc(p) || FALLBACK_PRODUCT_IMG}
                          alt={p?.name || "METHO Product"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => { applyLandingImageFallback(e, [pickProductImageSrc(p)]); }}
                        />
                        <span className="absolute top-2 left-2 pointer-events-none text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-amber-500 text-emerald-950">
                          METHO
                        </span>
                      </div>
                      <div className="p-3">
                        <p className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold truncate">{p?.category || group.category}</p>
                        <p className="font-display font-bold text-emerald-950 text-sm line-clamp-1 mt-0.5">{p?.name || `Best Product ${i + 1}`}</p>
                        <div className="mt-1.5 flex items-center justify-between">
                          {Number(p?.price) > 0 ? (
                            <>
                              <span className="font-display font-black text-lg text-emerald-950">₹{getCustomerUnitPrice(p).toLocaleString("en-IN")}</span>
                              {Number(p?.gst_percent || 0) > 0 ? <span className="text-[10px] text-amber-700 font-semibold">GST {Number(p.gst_percent)}% Included</span> : null}
                            </>
                          ) : <span />}
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-900">METHO</span>
                        </div>
                        <div className="mt-3">
                          {outOfStock ? (
                            <Button disabled size="sm" className="w-full rounded-full text-xs">Out of Stock</Button>
                          ) : qty > 0 ? (
                            <div className="flex items-center justify-between bg-emerald-50 rounded-full px-2 py-1" data-testid={`hero-best-product-stepper-${id || i}`}>
                              <button
                                type="button"
                                onClick={() => adjustCartQty(p, -1)}
                                className="w-7 h-7 rounded-full bg-white hover:bg-emerald-100 flex items-center justify-center text-emerald-950 font-bold"
                                data-testid={`hero-best-product-dec-${id || i}`}
                              >
                                −
                              </button>
                              <span className="text-sm font-bold text-emerald-950" data-testid={`hero-best-product-qty-${id || i}`}>{qty}</span>
                              <button
                                type="button"
                                onClick={() => adjustCartQty(p, 1)}
                                className="w-7 h-7 rounded-full bg-white hover:bg-emerald-100 flex items-center justify-center text-emerald-950 font-bold"
                                data-testid={`hero-best-product-inc-${id || i}`}
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              className="w-full bg-emerald-900 hover:bg-emerald-950 rounded-full text-xs"
                              onClick={() => (id ? adjustCartQty(p, 1) : nav("/shop"))}
                              data-testid={`hero-best-product-add-${id || i}`}
                            >
                              Add to Cart
                            </Button>
                          )}
                          {videoUrl ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full mt-2 rounded-full text-xs"
                              onClick={() => window.open(videoUrl, "_blank", "noopener,noreferrer")}
                              data-testid={`hero-best-product-watch-video-${id || i}`}
                            >
                              Watch Video
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {cartItemCount > 0 && !checkoutOpen ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-900/15 bg-emerald-50/70 px-4 py-3" data-testid="hero-best-products-cart-summary">
            <p className="text-sm font-semibold text-emerald-950">
              {cartItemCount} item(s) selected{cartSubtotal > 0 ? ` · ₹${cartSubtotal.toLocaleString("en-IN")}` : ""}
            </p>
            <Button
              onClick={() => setCheckoutOpen(true)}
              className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-5"
              data-testid="hero-best-products-checkout"
            >
              Checkout <ArrowRight className="ml-1 w-4 h-4" />
            </Button>
          </div>
        ) : null}

        <Link to="/shop" data-testid="hero-best-products-view-all-mobile" className="md:hidden inline-flex mt-4">
          <Button variant="outline" className="rounded-full border-emerald-900/20 hover:bg-emerald-50 hover:text-emerald-900 w-full">
            View All Products <ChevronRight className="ml-1 w-4 h-4" />
          </Button>
        </Link>
      </div>

      <UpiPaymentDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        items={checkoutItems}
        total={checkoutTotal}
        isGuest={!user}
        memberRef={guestMemberRef}
        onMemberRefChange={setGuestMemberRef}
        onItemQtyChange={adjustCheckoutItemQty}
        onOrderPlaced={() => {
          setCheckoutOpen(false);
          setCartQty({});
          setGuestMemberRef("");
        }}
      />
    </div>
  </section>
  );
};

const Features = () => {
  const { settings } = useSettings();
  const [sectionRef, isSectionActive] = useSectionActivation();
  const showMethoStore = settings?.landing_show_metho_store !== false;
  const featuredStoreIds = useMemo(() => {
    const raw = settings?.landing_featured_store_ids;
    if (!Array.isArray(raw)) return [];
    const ids = [];
    raw.forEach((item) => {
      const id = String(item || "").trim();
      if (!id || ids.includes(id)) return;
      ids.push(id);
    });
    return ids.slice(0, 4);
  }, [settings?.landing_featured_store_ids]);
  const [storeListings, setStoreListings] = React.useState([]);
  const [loadingStore, setLoadingStore] = React.useState(true);
  const [tourismListings, setTourismListings] = React.useState([]);
  const [loadingTourism, setLoadingTourism] = React.useState(true);

  useEffect(() => {
    if (!isSectionActive) return;
    let active = true;
    setLoadingStore(true);

    methoStoreApi
      .publicListStoreListings()
      .then((data) => {
        if (!active) return;
        const rows = normalizeCollection(data);
        const activeRows = rows.filter((p) => (p?.is_active ?? p?.active ?? p?.approved ?? true) !== false);
        const keyOf = (item) => String(item?.id || item?.owner_id || item?.owner_code || item?.code || "").trim();
        const byId = new Map(activeRows.map((item) => [keyOf(item), item]));
        const selected = featuredStoreIds.map((id) => byId.get(id)).filter(Boolean);
        const next = selected.length > 0 ? selected.slice(0, 4) : activeRows.slice(0, 4);
        setStoreListings(next);
      })
      .catch(() => {
        if (active) setStoreListings([]);
      })
      .finally(() => {
        if (active) setLoadingStore(false);
      });

    return () => {
      active = false;
    };
  }, [featuredStoreIds, isSectionActive]);

  useEffect(() => {
    if (!isSectionActive) return;
    let active = true;
    setLoadingTourism(true);
    loadLandingProducts().then((rows) => {
      if (!active) return;
      setTourismListings(rows.filter((item) => String(item?.product_type || "").toLowerCase() === "metho_service" && Boolean(item?.is_service)).slice(0, 2));
    }).catch(() => {
      if (active) setTourismListings([]);
    }).finally(() => {
      if (active) setLoadingTourism(false);
    });
    return () => { active = false; };
  }, [isSectionActive]);

  if (!showMethoStore) return null;

  return (
    <section ref={sectionRef} id="features" className="py-24 bg-[linear-gradient(180deg,#ffffff_0%,#f4faf7_100%)]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">METHO Store &amp; Travel</p>
          <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950">
            Shop locally. Plan your next trip.
            <span className="text-amber-500 italic"> Live listings, one destination.</span>
          </h2>
          <p className="mt-4 text-slate-600 font-body">Store listings and travel services are managed separately by admin and appear here automatically when available.</p>
        </div>
        <div className="mt-10 grid gap-5 xl:grid-cols-2">
        <div className="rounded-3xl border border-emerald-900/10 bg-white/90 p-4 md:p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-800">METHO Store</p><p className="mt-1 text-sm text-slate-600">Latest local store listings</p></div><Store className="h-6 w-6 text-emerald-800" /></div>
          {loadingStore ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 animate-pulse">
                  <div className="aspect-[4/3] bg-slate-200" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 rounded bg-slate-200 w-3/4" />
                    <div className="h-3 rounded bg-slate-200 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : storeListings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/60 p-6 text-center">
              <p className="font-semibold text-emerald-900">No METHO Store listings yet.</p>
              <p className="mt-1 text-sm text-slate-600">Admin Metho Store API data will auto appear here after stores are available.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4" data-testid="landing-features-store-grid">
              {storeListings.map((store, i) => (
                <motion.div
                  key={store.id || store.owner_id || `${store.owner_code || "store"}-${i}`}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: i * 0.03 }}
                >
                  <Link
                    to="/metho-store"
                    className="group block rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 hover:bg-white hover:shadow-md transition-all"
                    data-testid={`landing-feature-store-listing-${i + 1}`}
                  >
                    <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                      {store.banner_url || store.logo_url ? (
                        <img
                          src={resolveAssetUrl(store.banner_url || store.logo_url) || FALLBACK_PRODUCT_IMG}
                          alt={store.store_name || store.business_name || "METHO Store"}
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                          loading="lazy"
                          onError={(e) => { applyLandingImageFallback(e, [resolveAssetUrl(store.logo_url)]); }}
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center bg-emerald-50 text-emerald-800">
                          <Store className="w-8 h-8" />
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="font-semibold text-emerald-950 text-sm line-clamp-1">{store.store_name || store.business_name || "METHO Store"}</p>
                      <p className="mt-1 text-xs text-slate-500 line-clamp-1">{store.city || "Unknown city"} • {store.state || "India"}</p>
                      <p className="mt-1.5 text-[10px] uppercase tracking-wider text-emerald-800 font-bold line-clamp-1">{store.owner_code || store.code || "STORE"}</p>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}

          <div className="mt-5 flex justify-center">
            <Link to="/metho-store" data-testid="landing-features-store-view-all">
              <Button variant="outline" className="rounded-full border-emerald-900/20 bg-white hover:bg-emerald-50 hover:text-emerald-900">
                View Full METHO Store <ChevronRight className="ml-1 w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
        <div className="rounded-3xl border border-sky-200 bg-sky-50/70 p-4 md:p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-sky-800">METHO Travel</p><p className="mt-1 text-sm text-slate-600">Reserve curated travel services</p></div><Plane className="h-6 w-6 text-sky-800" /></div>
          {loadingTourism ? <div className="grid grid-cols-2 gap-3"><div className="aspect-[4/3] animate-pulse rounded-2xl bg-sky-100" /><div className="aspect-[4/3] animate-pulse rounded-2xl bg-sky-100" /></div> : tourismListings.length === 0 ? <div className="rounded-2xl border border-dashed border-sky-200 bg-white/80 p-6 text-center"><p className="font-semibold text-sky-950">Travel services are being curated.</p><p className="mt-1 text-sm text-slate-600">New destinations and packages will appear here.</p></div> : <div className="grid grid-cols-2 gap-3" data-testid="landing-features-tourism-grid">{tourismListings.map((service, index) => <article key={service.id} className="group overflow-hidden rounded-2xl border border-sky-100 bg-white hover:shadow-md" data-testid={`landing-feature-tourism-${index + 1}`}><Link to={`/shop?q=${encodeURIComponent(service.name || "")}`}><div className="aspect-[4/3] overflow-hidden bg-sky-100"><img src={pickProductImageSrc(service) || FALLBACK_PRODUCT_IMG} alt={service.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" onError={(e) => applyLandingImageFallback(e, [pickProductImageSrc(service)])} /></div></Link><div className="p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-sky-800">{service.category || "Tourism"}</p><p className="mt-1 text-sm font-semibold text-emerald-950 line-clamp-1">{service.name}</p><p className="mt-1 font-display text-base font-black text-emerald-950">₹{getCustomerUnitPrice(service).toLocaleString("en-IN")}</p><Link to={`/shop?q=${encodeURIComponent(service.name || "")}`} className="mt-3 inline-flex w-full"><Button size="sm" className="w-full rounded-full bg-emerald-900 text-xs text-white hover:bg-emerald-950" data-testid={`landing-feature-tourism-book-${index + 1}`}>Book Now <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></Link></div></article>)}</div>}
          <div className="mt-5 flex justify-center"><Link to="/shop" data-testid="landing-features-tourism-view-all"><Button variant="outline" className="rounded-full border-sky-300 bg-white text-sky-900 hover:bg-sky-100">Explore Travel <Plane className="ml-1 h-4 w-4" /></Button></Link></div>
        </div>
        </div>
      </div>
    </section>
  );
};

const BusinessPlan = () => {
  const { settings } = useSettings();
  const mission = (settings?.mission_statement || "").trim() || DEFAULT_POLICY.mission_statement;
  const vision = (settings?.vision_statement || "").trim() || DEFAULT_POLICY.vision_statement;
  const managementDirection = "Management operates a compliance-first, product-first execution model with unified onboarding, partner governance, and accountable payout operations.";

  return (
    <section id="plan" className="py-20 bg-gradient-to-b from-emerald-950 to-emerald-900 text-white relative overflow-hidden">
      <div className="absolute inset-0 grain opacity-30" />
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs uppercase tracking-[0.25em] text-amber-400 font-semibold">Corporate Foundation</p>
          <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight">
            Mission, Vision & Management
            <br />
            <span className="text-amber-400">direction for METHO growth.</span>
          </h2>
        </div>

        <div className="mt-10 grid md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-white/15 bg-white/10 backdrop-blur p-5">
            <p className="text-[10px] uppercase tracking-[0.24em] text-amber-300 font-semibold">Mission</p>
            <p className="mt-3 text-sm text-emerald-100/90 whitespace-pre-line font-body leading-relaxed">{mission}</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 backdrop-blur p-5">
            <p className="text-[10px] uppercase tracking-[0.24em] text-amber-300 font-semibold">Vision</p>
            <p className="mt-3 text-sm text-emerald-100/90 whitespace-pre-line font-body leading-relaxed">{vision}</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 backdrop-blur p-5">
            <p className="text-[10px] uppercase tracking-[0.24em] text-amber-300 font-semibold">Management</p>
            <p className="mt-3 text-sm text-emerald-100/90 font-body leading-relaxed">{managementDirection}</p>
          </div>
        </div>

        <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            "1. Member registration and KYC onboarding",
            "2. Partner and store activation",
            "3. Product commerce and order execution",
            "4. Smart income tracking and payout",
          ].map((step) => (
            <div key={step} className="rounded-xl border border-white/15 bg-emerald-950/35 px-4 py-3 text-sm text-emerald-100/95 font-medium">
              {step}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const ASSOCIATE_TYPES = [
  "All",
  "Retail Shop",
  "Super Market",
  "Pharmacy",
  "Restaurant",
  "Service Provider",
  "Distributor",
  "Wholesaler",
  "Online Seller",
];
const LANDING_PARTNER_CARD_LIMIT = 12;

const AssociatePartnerFinder = () => {
  const { settings } = useSettings();
  const [sectionRef, isSectionActive] = useSectionActivation();
  const directoryHero = settings?.directory_hero_image_url_full || "";
  const showPartnerShop = settings?.landing_show_partner_shop !== false;
  const featuredPartnerIds = useMemo(() => {
    const raw = settings?.landing_featured_partner_ids;
    if (!Array.isArray(raw)) return [];
    const ids = [];
    raw.forEach((item) => {
      const id = String(item || "").trim();
      if (!id || ids.includes(id)) return;
      ids.push(id);
    });
    return ids.slice(0, 4);
  }, [settings?.landing_featured_partner_ids]);
  const [cities, setCities] = React.useState([]);
  const [categories, setCategories] = React.useState([]);
  const [results, setResults] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  const [nameQuery, setNameQuery] = React.useState("");
  const [city, setCity] = React.useState("");
  const [pincode, setPincode] = React.useState("");
  const [businessType, setBusinessType] = React.useState("All");
  const [serviceQuery, setServiceQuery] = React.useState("");
  const [category, setCategory] = React.useState("");
  const debouncedNameQuery = useDebouncedValue(nameQuery, 280);
  const debouncedServiceQuery = useDebouncedValue(serviceQuery, 280);
  const debouncedCity = useDebouncedValue(city, 280);
  const debouncedPincode = useDebouncedValue(pincode, 280);
  const debouncedBusinessType = useDebouncedValue(businessType, 280);
  const debouncedCategory = useDebouncedValue(category, 280);

  useEffect(() => {
    if (!isSectionActive) return;
    api.get("/directory/cities").then((r) => setCities(Array.isArray(r.data) ? r.data : [])).catch(() => setCities([]));
    api.get("/directory/categories").then((r) => setCategories(Array.isArray(r.data) ? r.data : [])).catch(() => setCategories([]));
  }, [isSectionActive]);

  useEffect(() => {
    if (!isSectionActive) return;
    const params = new URLSearchParams();
    const q = [debouncedNameQuery, debouncedServiceQuery].map((v) => String(v || "").trim()).filter(Boolean).join(" ").trim();
    if (q) params.set("q", q);
    if (debouncedCity) params.set("city", debouncedCity);
    if (debouncedPincode) params.set("pincode", debouncedPincode);
    if (debouncedBusinessType && debouncedBusinessType !== "All") params.set("business_type", debouncedBusinessType);
    if (debouncedCategory) params.set("category", debouncedCategory);

    setLoading(true);
    api.get(`/directory/partners?${params.toString()}`)
      .then((r) => {
        const rows = Array.isArray(r.data) ? r.data : [];
        const hasSearchFilters = Boolean(q || debouncedCity || debouncedPincode || (debouncedBusinessType && debouncedBusinessType !== "All") || debouncedCategory);
        if (hasSearchFilters) {
          setResults(rows.slice(0, LANDING_PARTNER_CARD_LIMIT));
          return;
        }
        const keyOf = (item) => String(item?.id || item?.partner_code || "").trim();
        const byId = new Map(rows.map((item) => [keyOf(item), item]));
        const selected = featuredPartnerIds.map((id) => byId.get(id)).filter(Boolean);
        const selectedKeys = new Set(selected.map((item) => keyOf(item)));
        const mergedRows = selected.length > 0
          ? [...selected, ...rows.filter((item) => !selectedKeys.has(keyOf(item)))]
          : rows;
        setResults(mergedRows.slice(0, LANDING_PARTNER_CARD_LIMIT));
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [debouncedNameQuery, debouncedCity, debouncedPincode, debouncedBusinessType, debouncedServiceQuery, debouncedCategory, featuredPartnerIds, isSectionActive]);

  useEffect(() => {
    if (!isSectionActive) return;
    const pin = normalizePincode(debouncedPincode);
    if (!isCompletePincode(pin)) return;
    api.get(`/directory/pincode-lookup?pincode=${encodeURIComponent(pin)}`)
      .then((r) => {
        const nextCity = String(r?.data?.city || "").trim();
        if (nextCity) setCity(nextCity);
      })
      .catch(() => {});
  }, [debouncedPincode, isSectionActive]);

  const isServicePartner = (partner) => {
    const type = String(partner?.business_type || "").trim().toLowerCase();
    return type.includes("service");
  };

  const productPartners = results.filter((partner) => !isServicePartner(partner));
  const servicePartners = results.filter((partner) => isServicePartner(partner));

  if (!showPartnerShop) return null;

  return (
    <section ref={sectionRef} id="partner-finder" className="py-14 bg-[linear-gradient(180deg,#ffffff_0%,#f2f8f5_100%)]" data-testid="landing-associate-partner-finder">
      <div className="max-w-7xl mx-auto px-6">
        <div className="relative rounded-3xl overflow-hidden">
          {directoryHero ? (
            <div
              className="absolute inset-0 bg-cover bg-center opacity-10"
              style={{ backgroundImage: `url(${directoryHero})` }}
              aria-hidden="true"
            />
          ) : null}

          <div className="relative rounded-3xl border border-emerald-200/70 bg-gradient-to-b from-white via-emerald-50/30 to-white p-4 md:p-5 shadow-md">
            <p className="text-[10px] uppercase tracking-[0.28em] text-emerald-800 font-bold">Landing Partner Shops</p>
            <h3 className="mt-2 font-display font-black text-2xl leading-tight text-emerald-950">Featured Partner Shop List</h3>
            <p className="mt-1 text-xs text-slate-600 font-body">Admin-selected partner shop list with more room for cards.</p>

            <div className="mt-4 grid md:grid-cols-2 xl:grid-cols-6 gap-2.5 rounded-2xl border border-emerald-300/70 bg-gradient-to-r from-emerald-100/90 via-emerald-50/95 to-amber-50/85 p-3 shadow-inner">
              <div className="xl:col-span-2 relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={nameQuery}
                  onChange={(e) => setNameQuery(e.target.value)}
                  placeholder="Name / Partner / Shop"
                  className="h-11 w-full rounded-xl border border-emerald-200 bg-white/95 backdrop-blur-sm shadow-sm pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-emerald-300"
                  data-testid="landing-partner-search-name"
                />
              </div>

              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="h-11 rounded-xl border border-emerald-200 bg-white/95 backdrop-blur-sm shadow-sm px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-300"
                data-testid="landing-partner-search-city"
              >
                <option value="">All city</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>

              <input
                value={pincode}
                onChange={(e) => setPincode(normalizePincode(e.target.value))}
                placeholder="Pincode"
                maxLength={6}
                className="h-11 rounded-xl border border-emerald-200 bg-white/95 backdrop-blur-sm shadow-sm px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-300 font-mono"
                data-testid="landing-partner-search-pincode"
              />

              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                className="h-11 rounded-xl border border-emerald-200 bg-white/95 backdrop-blur-sm shadow-sm px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-300"
                data-testid="landing-partner-search-business"
              >
                {ASSOCIATE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>

              <input
                value={serviceQuery}
                onChange={(e) => setServiceQuery(e.target.value)}
                placeholder="Service"
                className="h-11 rounded-xl border border-emerald-200 bg-white/95 backdrop-blur-sm shadow-sm px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-300"
                data-testid="landing-partner-search-service"
              />

              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-11 rounded-xl border border-emerald-200 bg-white/95 backdrop-blur-sm shadow-sm px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-300"
                data-testid="landing-partner-search-category"
              >
                <option value="">All category</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-b from-emerald-50/65 to-white p-3 shadow-inner max-h-[430px] overflow-y-auto">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-800 font-bold">Product Shops</p>
                  <span className="text-[10px] text-slate-500 font-semibold">{productPartners.length} found</span>
                </div>
                {loading ? (
                  <p className="text-sm text-slate-500">Searching product shops...</p>
                ) : productPartners.length === 0 ? (
                  <p className="text-sm text-slate-500">No product shop found.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2.5">
                    {productPartners.slice(0, LANDING_PARTNER_CARD_LIMIT).map((p) => (
                      <Link
                        key={p.id || p.partner_code}
                        to={`/partner-shop/${p.partner_code}`}
                        className="rounded-xl border border-emerald-300/45 bg-white hover:bg-emerald-50/70 p-3 shadow-sm transition-colors"
                        data-testid={`landing-partner-result-product-${p.partner_code}`}
                      >
                        <div className="mb-2 inline-flex items-center rounded-full bg-emerald-100 text-emerald-900 px-2 py-0.5">
                          <p className="text-[10px] uppercase tracking-widest font-bold">{p.partner_code}</p>
                        </div>
                        <p className="font-display font-bold text-emerald-950 mt-0.5 line-clamp-1">{p.business_name}</p>
                        <p className="text-xs text-slate-600 mt-1 flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-emerald-700" /> {p.city || "Unknown city"}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{p.business_type || "Business"}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-b from-emerald-50/65 to-white p-3 shadow-inner max-h-[430px] overflow-y-auto">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-800 font-bold">Service Shops</p>
                  <span className="text-[10px] text-slate-500 font-semibold">{servicePartners.length} found</span>
                </div>
                {loading ? (
                  <p className="text-sm text-slate-500">Searching service shops...</p>
                ) : servicePartners.length === 0 ? (
                  <p className="text-sm text-slate-500">No service shop found.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2.5">
                    {servicePartners.slice(0, LANDING_PARTNER_CARD_LIMIT).map((p) => (
                      <Link
                        key={p.id || p.partner_code}
                        to={`/partner-shop/${p.partner_code}`}
                        className="rounded-xl border border-emerald-300/45 bg-white hover:bg-emerald-50/70 p-3 shadow-sm transition-colors"
                        data-testid={`landing-partner-result-service-${p.partner_code}`}
                      >
                        <div className="mb-2 inline-flex items-center rounded-full bg-emerald-100 text-emerald-900 px-2 py-0.5">
                          <p className="text-[10px] uppercase tracking-widest font-bold">{p.partner_code}</p>
                        </div>
                        <p className="font-display font-bold text-emerald-950 mt-0.5 line-clamp-1">{p.business_name}</p>
                        <p className="text-xs text-slate-600 mt-1 flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-emerald-700" /> {p.city || "Unknown city"}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{p.business_type || "Business"}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
};

const Products = () => {
  const { settings } = useSettings();
  const [sectionRef, isSectionActive] = useSectionActivation();
  const placeholder = settings?.product_placeholder_image_url_full || FALLBACK_PRODUCT_IMG;
  const [products, setProducts] = React.useState([]);
  useEffect(() => {
    if (!isSectionActive) return;
    if (process.env.NODE_ENV !== "production") {
      api.post("/seed").catch(() => {});
    }
    loadLandingProducts().then((rows) => setProducts(mixProductsByCategory(rows.filter(isVisibleMethoProduct), 6))).catch(() => {});
  }, [isSectionActive]);
  return (
    <section ref={sectionRef} id="products" className="relative py-24 overflow-hidden bg-[radial-gradient(circle_at_10%_20%,rgba(16,185,129,0.12),transparent_38%),radial-gradient(circle_at_90%_0%,rgba(245,158,11,0.14),transparent_42%),linear-gradient(180deg,#f8faf9_0%,#eef7f2_100%)]">
      <div className="absolute inset-0 grain opacity-20" />
      <div className="absolute left-6 top-8 md:left-14 md:top-12 rounded-2xl border border-emerald-900/10 bg-white/80 backdrop-blur px-3 py-2 shadow-sm">
        <p className="text-[10px] uppercase tracking-[0.24em] text-emerald-800 font-semibold">METHO Product Browser</p>
      </div>
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="rounded-3xl border border-emerald-900/10 bg-white/72 p-4 md:p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">METHO Products</p>
            <h2 className="mt-2 font-display font-black text-3xl md:text-4xl tracking-tight text-emerald-950">
              Products that move daily.
              <br />
              <span className="text-amber-500 italic">Clean catalog. Fast partner sales.</span>
            </h2>
            <p className="mt-3 text-slate-600 max-w-2xl">From essentials to high-demand picks, every item is designed for repeat purchase behavior and reliable business volume.</p>
          </div>
          <Link to="/shop" data-testid="products-view-all">
            <Button variant="outline" className="rounded-full border-emerald-900/20 hover:bg-emerald-50 hover:text-emerald-900">
              View All Products <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
          {["Fast moving", "Member-friendly pricing", "Partner-ready margins", "Real-time stock"].map((tag) => (
            <span key={tag} className="rounded-full border border-emerald-900/10 bg-white/80 px-3 py-1 font-semibold text-emerald-900">{tag}</span>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {products.map((p, i) => (
            <Link
              key={p.id}
              to={p?.name ? `/shop?q=${encodeURIComponent(p.name)}` : "/shop"}
              className="group block bg-white/95 backdrop-blur rounded-xl overflow-hidden border border-emerald-900/10 hover:shadow-lg hover:shadow-emerald-900/10 hover:-translate-y-0.5 transition-all"
              data-testid={`product-card-${i}`}
            >
              <div className="aspect-[4/3] overflow-hidden bg-gradient-to-br from-white to-emerald-50/40">
                <img
                  src={pickProductImageSrc(p) || placeholder}
                  alt={p.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  loading="lazy"
                  decoding="async"
                  onError={(e) => { applyLandingImageFallback(e, [pickProductImageSrc(p)], placeholder || FALLBACK_PRODUCT_IMG); }}
                />
              </div>
              <div className="p-3">
                <p className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold">{p.category}</p>
                <h4 className="mt-1 font-display font-bold text-emerald-950 line-clamp-1">{p.name}</h4>
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-display font-black text-base text-emerald-950">₹{getCustomerUnitPrice(p).toLocaleString("en-IN")}</span>
                  {p.product_type === "associate_partner" ? (
                    <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-semibold">Partner</span>
                  ) : (
                    <span className="text-xs bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full font-semibold">METHO</span>
                  )}
                </div>
                <div className="mt-2">
                  <span className="inline-flex items-center text-xs font-semibold text-emerald-800">
                    Open Product <ChevronRight className="ml-1 w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </Link>
          ))}
          {products.length === 0 && (
            <div className="col-span-full rounded-2xl border border-emerald-900/10 bg-white/90 p-6 text-center">
              <p className="font-display font-bold text-emerald-950">Product catalog is loading</p>
              <p className="mt-1 text-sm text-slate-600">Open the shop to explore the full live METHO product browser.</p>
              <Link to="/shop" className="inline-flex mt-4">
                <Button variant="outline" className="rounded-full border-emerald-900/20 hover:bg-emerald-50 hover:text-emerald-900">Open Shop</Button>
              </Link>
            </div>
          )}
        </div>
        </div>
      </div>
    </section>
  );
};

const Tourism = () => {
  const { settings } = useSettings();
  const [sectionRef, isSectionActive] = useSectionActivation();
  const placeholder = settings?.product_placeholder_image_url_full || FALLBACK_PRODUCT_IMG;
  const [services, setServices] = useState([]);
  const [tourismMedia, setTourismMedia] = useState([]);

  useEffect(() => {
    if (!isSectionActive) return;
    Promise.all([
      loadLandingProducts(),
      api.get("/tourism/booking-images").then((response) => response?.data?.items || []).catch(() => []),
    ]).then(([rows, media]) => {
      setTourismMedia(Array.isArray(media) ? media : []);
      setServices(rows.filter((item) => {
        const type = String(item?.product_type || "").toLowerCase();
        const templateKey = String(item?.service_template_key || "").toLowerCase();
        const hidden = item?.hidden === true || String(item?.hidden).toLowerCase() === "true" || String(item?.hidden) === "1";
        return type === "metho_service" && (item?.is_service || item?.service_booking_enabled || templateKey === "tourism_booking") && !hidden;
      }).slice(0, 3));
    }).catch(() => {
      setServices([]);
      setTourismMedia([]);
    });
  }, [isSectionActive]);

  const bannerService = services[0];
  const bannerImage = pickProductImageSrc(bannerService);
  const customTourismBanner = settings?.landing_tourism_banner_image_url_full || settings?.landing_tourism_banner_image_url;
  const displayBannerImage = customTourismBanner || bannerImage || resolveAssetUrl(tourismMedia[0]?.url);

  return (
    <section ref={sectionRef} id="travel" className="relative overflow-hidden bg-gradient-to-br from-sky-50 via-white to-emerald-50 py-16 text-slate-800" data-testid="landing-tourism-section">
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">METHO Tour &amp; Travels</p>
            <h2 className="mt-2 font-display text-3xl font-black tracking-tight md:text-4xl">Travel plans, ready to reserve.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Browse curated tourism services, choose a preferred date and complete a secure booking request. Final availability and itinerary are confirmed through the booking team.</p>
          </div>
          <Link to="/shop" data-testid="landing-tourism-view-all"><Button className="rounded-full bg-amber-400 text-emerald-950 hover:bg-amber-300">Explore Travel <Plane className="ml-2 h-4 w-4" /></Button></Link>
        </div>
        {displayBannerImage ? <div className="mx-auto mt-7 max-w-5xl overflow-hidden rounded-2xl border border-sky-300/40 bg-sky-900/60 p-2 shadow-2xl" data-testid="landing-tourism-banner-box">
          <div className="relative h-44 overflow-hidden rounded-xl bg-sky-900 sm:h-56 md:h-64">
            <img src={displayBannerImage} alt="METHO Tour & Travels" className="h-full w-full object-cover" loading="lazy" decoding="async" onError={(e) => applyLandingImageFallback(e, [displayBannerImage], placeholder)} />
            <div className="absolute inset-0 bg-gradient-to-r from-sky-950/65 via-sky-950/15 to-transparent" aria-hidden="true" />
            <div className="absolute inset-x-5 bottom-4 max-w-md sm:inset-x-8 sm:bottom-6"><p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">METHO Tour &amp; Travels</p><p className="mt-1 font-display text-xl font-black text-white drop-shadow md:text-3xl">Journeys curated for you.</p></div>
          </div>
        </div> : null}
        <div className="mx-auto mt-7 grid max-w-5xl gap-4 md:grid-cols-3">
          {services.map((service, index) => (
            <article key={service.id} className="group overflow-hidden rounded-xl border border-white/15 bg-white/95 text-slate-800 shadow-xl transition-transform hover:-translate-y-1" data-testid={`landing-tourism-card-${index}`}>
              <div className="relative h-40 overflow-hidden bg-sky-100 sm:h-44"><img src={pickProductImageSrc(service) || resolveAssetUrl(tourismMedia[index]?.url) || placeholder} alt={service.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" onError={(e) => applyLandingImageFallback(e, [pickProductImageSrc(service), resolveAssetUrl(tourismMedia[index]?.url)], placeholder)} /><span className="absolute left-3 top-3 rounded-full bg-sky-950/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white">METHO Travel</span></div>
              <div className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-sky-800">{service.category || "Tourism"}</p><h3 className="mt-1 font-display text-lg font-bold text-emerald-950 line-clamp-1">{service.name}</h3>{service.description ? <p className="mt-2 text-xs leading-5 text-slate-600 line-clamp-3">{service.description}</p> : null}<div className="mt-3 flex items-center justify-between gap-3"><span className="font-display text-xl font-black text-emerald-950">₹{getCustomerUnitPrice(service).toLocaleString("en-IN")}</span><span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-800"><CalendarDays className="h-3.5 w-3.5" /> Date-based booking</span></div><Link to={`/shop?q=${encodeURIComponent(service.name || "")}`} className="mt-4 inline-flex w-full"><Button className="w-full rounded-full bg-emerald-900 text-white hover:bg-emerald-950" data-testid={`landing-tourism-book-${index}`}>Book Now <ArrowRight className="ml-2 h-4 w-4" /></Button></Link></div>
            </article>
          ))}
          {services.length === 0 ? <div className="md:col-span-3 rounded-lg border border-dashed border-sky-300 bg-white/80 p-7 text-center"><p className="font-display text-lg font-bold text-sky-950">Travel services are being curated</p><p className="mt-1 text-sm text-slate-600">New destinations and packages will appear here as they are released.</p><Link to="/shop" className="mt-4 inline-flex"><Button variant="outline" className="rounded-full border-sky-300 bg-white text-sky-900 hover:bg-sky-50">Open Shop &amp; Travel</Button></Link></div> : null}
        </div>
        <p className="mt-5 text-xs text-slate-500">Travel bookings are governed by the <Link to="/travel-booking-terms" className="font-semibold text-sky-800 underline">Travel Booking Terms</Link>.</p>
      </div>
    </section>
  );
};

const TopLeaders = () => {
  const { settings } = useSettings();
  const leaders = [
    {
      name: settings?.top_leader_1_name || "Leader 1",
      title: settings?.top_leader_1_title || "MD",
      image: settings?.top_leader_1_image_url_full,
    },
    {
      name: settings?.top_leader_2_name || "Leader 2",
      title: settings?.top_leader_2_title || "CEO",
      image: settings?.top_leader_2_image_url_full,
    },
    {
      name: settings?.top_leader_3_name || "Leader 3",
      title: settings?.top_leader_3_title || "Mentor",
      image: settings?.top_leader_3_image_url_full,
    },
    {
      name: settings?.top_leader_4_name || "Leader 4",
      title: settings?.top_leader_4_title || "Growth Mentor",
      image: settings?.top_leader_4_image_url_full,
    },
    {
      name: settings?.top_leader_5_name || "Leader 5",
      title: settings?.top_leader_5_title || "Business Leader",
      image: settings?.top_leader_5_image_url_full,
    },
    {
      name: settings?.top_leader_6_name || "Leader 6",
      title: settings?.top_leader_6_title || "Senior Advisor",
      image: settings?.top_leader_6_image_url_full,
    },
  ];

  return (
    <section className="py-16 bg-gradient-to-b from-white to-amber-50/40" data-testid="top-leaders-section">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">Management Board</p>
          <h2 className="mt-2 font-display font-black text-3xl md:text-4xl tracking-tight text-emerald-950">Top Leaders of METHO</h2>
          <p className="mt-3 text-sm text-slate-600 max-w-2xl">Leadership profiles are managed from admin settings and presented here for corporate trust visibility.</p>
        </div>
        <div className="mt-8 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {leaders.map((leader, i) => (
            <div key={i} className="mx-auto w-full max-w-[220px] bg-white rounded-2xl border border-emerald-900/10 overflow-hidden shadow-sm hover:shadow-md transition-shadow" data-testid={`top-leader-card-${i + 1}`}>
              <div className="aspect-[3/4] overflow-hidden bg-secondary">
                <img
                  src={leader.image || FALLBACK_LEADER_IMG}
                  alt={leader.name}
                  data-original-src={leader.image || ""}
                  data-has-custom={leader.image ? "1" : "0"}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    const img = e.currentTarget;
                    const hasCustom = img.dataset.hasCustom === "1";
                    const originalSrc = img.dataset.originalSrc || "";

                    // Keep admin-uploaded image sticky: retry once with cache-buster, then stop.
                    if (hasCustom && originalSrc) {
                      const isRetriableUrl =
                        originalSrc.startsWith("http://") ||
                        originalSrc.startsWith("https://") ||
                        originalSrc.startsWith("/") ||
                        originalSrc.startsWith("api/");
                      if (isRetriableUrl) {
                        if (img.dataset.retriedCustom !== "1") {
                          img.dataset.retriedCustom = "1";
                          const sep = originalSrc.includes("?") ? "&" : "?";
                          img.src = `${originalSrc}${sep}img_retry=${Date.now()}`;
                          return;
                        }
                      }
                    }
                    if (img.src !== FALLBACK_LEADER_IMG) img.src = FALLBACK_LEADER_IMG;
                  }}
                />
              </div>
              <div className="p-3.5 bg-emerald-50/45 border-t border-emerald-100">
                <p className="font-display font-bold text-sm text-emerald-950 truncate" title={leader.name}>{leader.name}</p>
                <p className="mt-0.5 text-[11px] text-amber-700 font-semibold tracking-wide uppercase truncate" title={leader.title}>{leader.title}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const MissionVisionPolicy = () => {
  const { settings } = useSettings();
  const mission = (settings?.mission_statement || "").trim() || DEFAULT_POLICY.mission_statement;
  const vision = (settings?.vision_statement || "").trim() || DEFAULT_POLICY.vision_statement;

  return (
    <section className="py-24 bg-secondary/30" data-testid="landing-policy-section">
      <div className="max-w-6xl mx-auto px-6">
        <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold text-center">Business Direction</p>
        <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950 text-center">
          Mission and Vision
        </h2>

        <div className="mt-10 grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-border p-6">
            <p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Mission</p>
            <p className="mt-2 text-sm text-slate-700 whitespace-pre-line font-body">{mission}</p>
          </div>
          <div className="bg-white rounded-2xl border border-border p-6">
            <p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Vision</p>
            <p className="mt-2 text-sm text-slate-700 whitespace-pre-line font-body">{vision}</p>
          </div>
        </div>
      </div>
    </section>
  );
};

const ReturnPolicyBox = () => {
  const { settings } = useSettings();
  const returnPolicy = (settings?.return_policy || "").trim() || DEFAULT_POLICY.return_policy;
  const policyLines = returnPolicy
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);

  return (
    <section id="return-policy" className="py-10 bg-white" data-testid="landing-return-policy-box">
      <div className="max-w-6xl mx-auto px-6">
        <div className="rounded-2xl border border-emerald-900/10 bg-gradient-to-br from-white to-emerald-50/40 p-6 md:p-7 shadow-sm">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">Customer Protection</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <h3 className="font-display font-black text-2xl md:text-3xl tracking-tight text-emerald-950">Return Policy Snapshot</h3>
            <Link to="/shop" data-testid="landing-return-policy-open-shop">
              <Button variant="outline" className="rounded-full border-emerald-900/20 bg-white hover:bg-emerald-50 hover:text-emerald-900">
                Open Product Catalog <ChevronRight className="ml-1 w-4 h-4" />
              </Button>
            </Link>
          </div>
          <div className="mt-4 grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2 rounded-xl border border-emerald-100 bg-white/90 p-4">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Policy Highlights</p>
              <div className="mt-2 space-y-2">
                {policyLines.map((line, idx) => (
                  <p key={`${line}-${idx}`} className="text-sm text-slate-700 font-body leading-relaxed">{line}</p>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Need Assistance?</p>
              <p className="mt-2 text-sm text-slate-700 font-body leading-relaxed">Contact support with order details for faster review and resolution.</p>
              <div className="mt-4 grid gap-2">
                <Link to="/login" data-testid="landing-return-policy-login">
                  <Button variant="outline" className="w-full rounded-full border-emerald-900/20 bg-white hover:bg-emerald-50 hover:text-emerald-900">Member Login</Button>
                </Link>
                <Link to="/partner-register" data-testid="landing-return-policy-partner-register">
                  <Button className="w-full rounded-full bg-emerald-900 hover:bg-emerald-950 text-white">Partner Registration</Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const RegistrationAccessBox = () => (
  <section className="py-10 bg-white" data-testid="landing-registration-access-box">
    <div className="max-w-6xl mx-auto px-6">
      <div className="rounded-2xl border border-emerald-900/20 bg-gradient-to-br from-emerald-100 via-emerald-50 to-amber-50/40 p-4 md:p-5 shadow-md">
        <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold px-2 pb-3">Registration & Access</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              key: "member",
              to: "/register",
              label: "Member",
              title: "Member Registration",
              desc: "Create your member account and start onboarding.",
              icon: Users,
              testId: "landing-registration-row-member",
            },
            {
              key: "partner",
              to: "/partner-register",
              label: "Partner",
              title: "Partner Registration",
              desc: "List your business and join the partner network.",
              icon: Building2,
              testId: "landing-registration-row-partner",
            },
            {
              key: "login",
              to: "/login",
              label: "Account",
              title: "Login",
              desc: "Access your dashboard, wallet, and business reports.",
              icon: Shield,
              testId: "landing-registration-row-login",
            },
            {
              key: "partner-login",
              to: "/login",
              label: "Partner Account",
              title: "Partner Login",
              desc: "Manage store activity, orders, and partner actions.",
              icon: Store,
              testId: "landing-registration-row-partner-login",
            },
          ].map((item) => (
            <Link key={item.key} to={item.to} className="rounded-xl border border-emerald-300 bg-emerald-950 p-4 hover:shadow-md transition-shadow" data-testid={item.testId}>
              <div className="w-10 h-10 rounded-xl bg-emerald-900 text-amber-300 flex items-center justify-center">
                <item.icon className="w-5 h-5" />
              </div>
              <p className="text-[10px] uppercase tracking-widest text-emerald-100 font-semibold mt-3">{item.label}</p>
              <p className="mt-1 font-display font-bold text-white">{item.title}</p>
              <p className="mt-1 text-xs text-emerald-100/85 font-body leading-relaxed">{item.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  </section>
);

const FAQ = () => {
  const faqs = [
    { q: "How do I join METHOO STORE?", a: "Register free with your phone, email & sponsor code. KYC verification takes 24 hours." },
    { q: "How much can I earn?", a: "Earnings depend on your team activity — Partners typically earn ₹5,000 to ₹2,00,000+ monthly." },
    { q: "How does the wallet work?", a: "Auto-credited in real-time. Withdraw via UPI, IMPS, or Bank. Minimum ₹100." },
    { q: "What is BV (Business Volume)?", a: "We've replaced BV with a direct ₹ Sales system. Every purchase adds real rupee volume to your Smart Cycle qualification — simpler, transparent, and easier to track." },
    { q: "Is this legal in India?", a: "Yes. METHOO STORE is a registered business company operating under Indian law." },
  ];
  const [open, setOpen] = React.useState(0);
  return (
    <section id="faq" className="py-24 bg-white">
      <div className="max-w-4xl mx-auto px-6">
        <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold text-center">FAQ</p>
        <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950 text-center">
          Questions? Answered.
        </h2>
        <div className="mt-12 divide-y divide-border border-y border-border">
          {faqs.map((f, i) => (
            <div key={i} data-testid={`faq-item-${i}`}>
              <button onClick={() => setOpen(open === i ? -1 : i)} className="w-full py-6 flex items-center justify-between text-left hover:text-emerald-800 transition-colors">
                <span className="font-display font-semibold text-lg text-emerald-950">{f.q}</span>
                <ChevronRight className={`w-5 h-5 transition-transform ${open === i ? "rotate-90" : ""}`} />
              </button>
              {open === i && <p className="pb-6 text-slate-600 font-body">{f.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Footer = () => {
  const { settings } = useSettings();
  const companyYoutubeUrl = normalizeYoutubeUrl(settings?.company_youtube_url);
  const companyFacebookUrl = normalizeFacebookUrl(settings?.company_facebook_url);

  return (
  <footer className="bg-emerald-950 text-emerald-100/80 py-14">
    <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-4 gap-10">
      <div className="md:col-span-2">
        <Logo showTagline />
        <p className="mt-4 max-w-sm text-sm font-body">India's most powerful business platform. Built by Metho Logistics Private Limited for the growing Partner community.</p>
        <div className="mt-4 flex items-center gap-3 text-xs">
          <Building2 className="w-4 h-4" /> Metho Logistics Private Limited
        </div>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-700 bg-emerald-900/45 px-3 py-1.5 text-sm text-emerald-100">
          <Phone className="w-4 h-4 text-amber-300" /> Contact: +91 7003805387
        </div>
        {(companyYoutubeUrl || companyFacebookUrl) ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {companyYoutubeUrl ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-amber-300 bg-amber-50 text-emerald-950 hover:bg-amber-100"
                onClick={() => window.open(companyYoutubeUrl, "_blank", "noopener,noreferrer")}
                data-testid="landing-footer-watch-video"
              >
                <PlayCircle className="w-4 h-4 mr-2" /> Watch Video
              </Button>
            ) : null}
            {companyFacebookUrl ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100"
                onClick={() => window.open(companyFacebookUrl, "_blank", "noopener,noreferrer")}
                data-testid="landing-footer-open-facebook"
              >
                Facebook
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div>
        <p className="font-display font-bold text-white uppercase tracking-widest text-xs">Product</p>
        <ul className="mt-3 space-y-2 text-sm">
          <li><Link to="/metho-store" className="hover:text-amber-400">View Metho Store</Link></li>
          <li><Link to="/shop" className="hover:text-amber-400">Shop</Link></li>
          <li><a href="#plan" className="hover:text-amber-400">Business Plan</a></li>
          <li><a href="#features" className="hover:text-amber-400">Features</a></li>
        </ul>
      </div>
      <div>
        <p className="font-display font-bold text-white uppercase tracking-widest text-xs">Access</p>
        <ul className="mt-3 space-y-2 text-sm">
          <li><Link to="/login" className="hover:text-amber-400">Login</Link></li>
          <li><Link to="/register" className="hover:text-amber-400">Register</Link></li>
          <li><Link to="/partner-register" className="hover:text-amber-400">Partner Register</Link></li>
          <li><Link to="/login" className="hover:text-amber-400">Partner Login</Link></li>
        </ul>
      </div>
    </div>
    <div className="mt-12 max-w-7xl mx-auto px-6 border-t border-emerald-800 pt-6 flex flex-wrap items-center justify-between gap-4 text-xs">
      <p>© 2026 Metho Logistics Private Limited. All rights reserved.</p>
      <div className="flex flex-wrap items-center gap-4">
        <Link to="/privacy-policy" className="hover:text-amber-400">Privacy Policy</Link>
        <p className="flex items-center gap-2"><Globe className="w-3 h-3" /> Powered by METHO Logistics ERP v3.0</p>
      </div>
    </div>
  </footer>
  );
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background" data-testid="landing-page">
      <Nav />
      <ReferralEntryStrip />
      <Hero />
      <AssociatePartnerFinder />
      <Products />
      <Tourism />
      <Features />
      <BusinessPlan />
      <TopLeaders />
      <ReturnPolicyBox />
      <Footer />
    </div>
  );
}


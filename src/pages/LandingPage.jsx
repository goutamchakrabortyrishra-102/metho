import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, TrendingUp, Users, Wallet, Shield, Award, Sparkles, Check, ChevronRight, Star, Building2, Zap, Globe, MapPin, Store, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import api from "@/services/api";
import { methoStoreApi, normalizeCollection } from "@/services/methoStore";
import { useSettings } from "@/contexts/SettingsContext";
import { resolveAssetUrl, getAssetImageFallbackCandidates } from "@/lib/utils";
import { isCompletePincode, normalizePincode } from "@/lib/indiaLocation";

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
const DEFAULT_POLICY = {
  mission_statement: "To build a trusted, product-driven smart earning ecosystem that delivers fair and sustainable income opportunities for everyone.",
  vision_statement: "Our vision is to empower marginalized people, transform small businesses from local to global, and build sustainable financial freedom with a special focus on women.",
  return_policy:
    "1. Return requests for defective, damaged, or incorrect products can be raised within 7 days of delivery.\n" +
    "2. Used, tampered, or physically damaged products are not eligible for return unless covered by an approved exception.\n" +
    "3. Approved returns are processed for refund or replacement within the committed service timeline.",
};

const Nav = () => (
  <header className="fixed top-0 left-0 right-0 z-50 glass" data-testid="landing-nav">
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3">
      <div className="hidden sm:block"><Logo showTagline /></div>
      <div className="sm:hidden"><Logo /></div>
      <nav className="hidden xl:flex items-center gap-6 font-body text-sm">
        <a href="#features" className="text-slate-700 hover:text-emerald-900 transition-colors">Features</a>
        <a href="#plan" className="text-slate-700 hover:text-emerald-900 transition-colors">Growth Plan</a>
        <a href="#partner-finder" className="text-slate-700 hover:text-emerald-900 transition-colors">Partner Finder</a>
        <a href="#products" className="text-slate-700 hover:text-emerald-900 transition-colors">Products</a>
        <a href="#return-policy" className="text-slate-700 hover:text-emerald-900 transition-colors">Return Policy</a>
      </nav>
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <Link to="/partner-register" className="hidden xl:inline-flex" data-testid="nav-partner-register-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">Partner Register</Button>
        </Link>
        <Link to="/metho-store" className="hidden md:inline-flex" data-testid="nav-metho-store-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">View Metho Store</Button>
        </Link>
        <Link to="/login" className="hidden xl:inline-flex" data-testid="nav-partner-login-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">Partner Login</Button>
        </Link>
        <Link to="/login?next=/app/metho-store-owner" className="hidden lg:inline-flex" data-testid="nav-store-login-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">Store Login</Button>
        </Link>
        <Link to="/login" data-testid="nav-login-link"><Button variant="ghost" size="sm" className="px-3 md:px-4 hover:bg-emerald-50 hover:text-emerald-900">Login</Button></Link>
        <Link to="/register" data-testid="nav-register-link">
          <Button size="sm" className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-4 md:px-5">Join Now <ArrowRight className="ml-1 w-4 h-4" /></Button>
        </Link>
      </div>
    </div>
  </header>
);

const Hero = () => {
  const { settings } = useSettings();
  const nav = useNavigate();
  const [shopSearch, setShopSearch] = useState("");
  const [bestProducts, setBestProducts] = useState([]);
  const hasBestProducts = bestProducts.length > 0;
  const LANDING_TOP_PRODUCTS_LIMIT = 10;
  const selectedTopProductIds = useMemo(() => {
    const raw = settings?.landing_top_product_ids;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .slice(0, LANDING_TOP_PRODUCTS_LIMIT);
  }, [settings?.landing_top_product_ids]);
  const HERO_IMG = settings?.landing_hero_image_url_full || DEFAULT_HERO_IMG;
  const tagline = settings?.landing_tagline;
  const subheading = settings?.landing_subheading;

  useEffect(() => {
    let active = true;
    api
      .get("/products?limit=200")
      .then((r) => {
        if (!active) return;
        const rows = normalizeCollection(r.data);
        const visibleProducts = rows.filter(isVisibleMethoProduct);
        const productById = new Map(visibleProducts.map((product) => [String(product?.id || ""), product]));
        const selectedProducts = selectedTopProductIds
          .map((id) => productById.get(id))
          .filter(Boolean);
        const picks = selectedProducts.length > 0
          ? selectedProducts.slice(0, LANDING_TOP_PRODUCTS_LIMIT)
          : visibleProducts.slice(0, LANDING_TOP_PRODUCTS_LIMIT);
        setBestProducts(picks);
      })
      .catch(() => {
        if (active) setBestProducts([]);
      });

    return () => {
      active = false;
    };
  }, [selectedTopProductIds]);

  const openShopWithSearch = () => {
    const q = String(shopSearch || "").trim();
    if (!q) {
      nav("/shop");
      return;
    }
    nav(`/shop?q=${encodeURIComponent(q)}`);
  };

  const onSearchKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      openShopWithSearch();
    }
  };

  return (
  <section className="relative pt-32 pb-20 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.14),transparent_28%),linear-gradient(180deg,#fffdf8_0%,#fbfaf6_46%,#f5f8f7_100%)]">
    <div className="absolute inset-0 grain" />
    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808] opacity-80" />
    <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-[28rem] h-[28rem] bg-amber-300/15 rounded-full blur-3xl" />
    <div className="absolute right-0 top-24 w-72 h-72 bg-emerald-900/6 rounded-full blur-3xl" />
    <div className="max-w-7xl mx-auto px-6 relative">
      <div className="grid lg:grid-cols-12 gap-8 items-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="lg:col-span-7">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/90 border border-emerald-900/10 text-emerald-900 text-xs font-semibold tracking-wide shadow-sm">
            <Sparkles className="w-3.5 h-3.5" /> Powered By Metho Logistics Private Limited
          </div>
          {tagline ? (
            <h1 className="mt-6 font-display font-black text-5xl md:text-6xl lg:text-7xl tracking-tighter leading-none text-emerald-950">
              {tagline}
            </h1>
          ) : (
            <h1 className="mt-6 font-display font-black text-5xl md:text-6xl lg:text-7xl tracking-tighter leading-none text-emerald-950">
              Build daily demand.
              <span className="text-amber-500 italic">Grow reliable income.</span>
              <br />
              <span className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800">One product ecosystem for members and partners.</span>
            </h1>
          )}
          {subheading ? (
            <p className="mt-6 max-w-xl text-lg text-slate-600 font-body leading-relaxed">{subheading}</p>
          ) : (
            <p className="mt-6 max-w-2xl text-lg text-slate-600 font-body leading-relaxed">
              METHO brings product commerce, partner distribution and reward automation into one clean operating system.
              <br />
              <span className="text-slate-500 text-base">Launch faster, sell smarter and track growth without manual complexity.</span>
            </p>
          )}
          <div className="mt-6 grid gap-3 sm:grid-cols-3 max-w-2xl">
            {[
              "Fast onboarding for field teams",
              "India-ready payout controls",
              "Smart growth and reward tracking",
            ].map((item) => (
              <div key={item} className="rounded-xl border border-emerald-900/10 bg-white/80 backdrop-blur px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
                {item}
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3 rounded-[1.75rem] border border-emerald-900/10 bg-gradient-to-r from-white/95 via-emerald-50/75 to-white/95 p-2.5 shadow-sm">
            <Link to="/register" className="w-full sm:w-auto" data-testid="hero-cta-register">
              <Button size="lg" className="bg-gradient-to-r from-emerald-900 to-emerald-800 hover:from-emerald-950 hover:to-emerald-900 text-white rounded-full px-7 h-12 text-base font-semibold w-full sm:w-auto shadow-lg shadow-emerald-900/20">
                Register Free — in 60 seconds <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
            <Link to="/partner-register" className="hidden sm:inline-flex" data-testid="hero-cta-partner-register">
              <Button size="lg" variant="outline" className="rounded-full px-7 h-12 text-base border-emerald-900/20 bg-white/95 shadow-sm hover:bg-emerald-50 hover:text-emerald-900">
                Partner Register <Building2 className="ml-1 w-4 h-4" />
              </Button>
            </Link>
            <Link to="/login" className="hidden sm:inline-flex" data-testid="hero-cta-partner-login">
              <Button size="lg" variant="outline" className="rounded-full px-7 h-12 text-base border-emerald-900/20 bg-white/95 shadow-sm hover:bg-emerald-50 hover:text-emerald-900">
                Partner Login <ChevronRight className="ml-1 w-4 h-4" />
              </Button>
            </Link>
            <Link to="/shop" className="w-full sm:w-auto" data-testid="hero-cta-shop">
              <Button size="lg" variant="outline" className="rounded-full px-7 h-12 text-base border-emerald-900/20 bg-white/95 shadow-sm hover:bg-emerald-50 hover:text-emerald-900 w-full sm:w-auto">
                Browse Products <ChevronRight className="ml-1 w-4 h-4" />
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
                  className="pl-9 h-12 rounded-full border-emerald-900/20 bg-white shadow-sm"
                  data-testid="hero-shop-search-input"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-full border-emerald-900/20 bg-white/95 shadow-sm hover:bg-emerald-50 hover:text-emerald-900"
                onClick={openShopWithSearch}
                data-testid="hero-shop-search-button"
              >
                <Search className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-emerald-700/40 bg-gradient-to-r from-emerald-900 via-emerald-800 to-emerald-900 p-3.5 text-white shadow-lg shadow-emerald-900/25" data-testid="hero-sector-quick-access">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-100 font-semibold">Member / Customer Direct Sector Access</p>
              <span className="text-[10px] text-emerald-100/80">One tap to browse</span>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-12">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 lg:col-span-7">
              <Link to="/directory?quick=products" className="group" data-testid="hero-sector-products">
                <div className="rounded-xl border border-emerald-200/35 bg-white/95 text-emerald-950 px-3 py-2.5 hover:bg-emerald-50 transition-colors">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">Sector</p>
                  <p className="text-sm font-bold mt-0.5">All Products</p>
                </div>
              </Link>
              <Link to="/directory?quick=transport" className="group" data-testid="hero-sector-transport">
                <div className="rounded-xl border border-emerald-200/35 bg-white/95 text-emerald-950 px-3 py-2.5 hover:bg-emerald-50 transition-colors">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">Sector</p>
                  <p className="text-sm font-bold mt-0.5">Transport</p>
                </div>
              </Link>
              <Link to="/directory?quick=stay-dining" className="group" data-testid="hero-sector-stay-dining">
                <div className="rounded-xl border border-emerald-200/35 bg-white/95 text-emerald-950 px-3 py-2.5 hover:bg-emerald-50 transition-colors">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">Sector</p>
                  <p className="text-sm font-bold mt-0.5">Stay & Dining</p>
                </div>
              </Link>
              <Link to="/directory?quick=doorstep" className="group" data-testid="hero-sector-doorstep">
                <div className="rounded-xl border border-emerald-200/35 bg-white/95 text-emerald-950 px-3 py-2.5 hover:bg-emerald-50 transition-colors">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">Sector</p>
                  <p className="text-sm font-bold mt-0.5">Doorstep</p>
                </div>
              </Link>
              <Link to="/directory?quick=other-services" className="group" data-testid="hero-sector-other-services">
                <div className="rounded-xl border border-emerald-200/35 bg-white/95 text-emerald-950 px-3 py-2.5 hover:bg-emerald-50 transition-colors">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">Sector</p>
                  <p className="text-sm font-bold mt-0.5">Other Services</p>
                </div>
              </Link>
              </div>

              <div className="lg:col-span-5 rounded-xl border border-emerald-200/35 bg-white/95 text-emerald-950 px-3 py-2.5" data-testid="hero-product-subsectors">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">Product Sectors</p>
                  <span className="text-[10px] text-slate-500">4 parts</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Link to="/directory?quick=vegetables" className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-2 text-sm font-semibold hover:bg-emerald-100 transition-colors" data-testid="hero-product-vegetables">
                    Vegetables
                  </Link>
                  <Link to="/directory?quick=grocery" className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-2 text-sm font-semibold hover:bg-emerald-100 transition-colors" data-testid="hero-product-grocery">
                    Grocery
                  </Link>
                  <Link to="/directory?quick=cosmetics-beauty" className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-2 text-sm font-semibold hover:bg-emerald-100 transition-colors" data-testid="hero-product-cosmetics-beauty">
                    Cosmetics &amp; Beauty
                  </Link>
                  <Link to="/directory?quick=others" className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-2 text-sm font-semibold hover:bg-emerald-100 transition-colors" data-testid="hero-product-others">
                    Others
                  </Link>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-10 flex items-center gap-1 text-amber-500" data-testid="hero-rating-stars">
            {[1, 2, 3, 4, 5].map((i) => <Star key={i} className="w-4 h-4 fill-current" />)}
            <p className="ml-2 text-xs text-slate-500 font-body">Trusted by growing partner offices across India</p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.2 }} className="lg:col-span-5 relative">
          <div className="relative">
            <div className="absolute -top-4 -left-4 w-28 h-28 bg-amber-300/30 rounded-full blur-3xl" />
            <div className="absolute -bottom-4 -right-4 w-40 h-40 bg-emerald-500/15 rounded-full blur-3xl" />
            <div className="absolute -left-3 top-10 bottom-10 w-1.5 rounded-full bg-gradient-to-b from-[#ff9933] via-white to-[#138808]" />
            <div className="relative rounded-[28px] overflow-hidden shadow-2xl border border-emerald-900/10 bg-white p-3">
              <div className="relative h-[480px] rounded-[22px] overflow-hidden bg-emerald-950">
                <img src={NETWORK_IMG} alt="Associate partner network" className="absolute inset-0 w-full h-full object-cover opacity-12" />
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950" />

                <div className="relative z-10 p-4 md:p-5 h-full flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="max-w-[78%]">
                      <p className="text-[9px] uppercase tracking-[0.3em] text-amber-300 font-bold">METHO Corporate Access</p>
                      <h3 className="mt-2 font-display font-black text-[1.35rem] md:text-[1.7rem] text-white leading-[1.08] tracking-tight">
                        One gateway for member growth and partner commerce.
                      </h3>
                      <p className="mt-2 text-[11px] md:text-xs text-emerald-100/80 leading-relaxed">
                        Join the network, onboard businesses, and discover products and services from one business-ready panel.
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/10 border border-white/15 p-2.5 md:p-3 text-white shrink-0 backdrop-blur-sm">
                      <Building2 className="w-5 h-5 md:w-6 md:h-6" />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2.5">
                    {[
                      {
                        title: "Member Registration",
                        subtitle: "Create member account in seconds",
                        href: "/register",
                        icon: Users,
                        tag: "ONBOARD",
                      },
                      {
                        title: "Partner Registration",
                        subtitle: "List your business with METHO",
                        href: "/partner-register",
                        icon: Building2,
                        tag: "BUSINESS",
                      },
                      {
                        title: "View All Products",
                        subtitle: "Browse complete METHO product catalog",
                        href: "/shop",
                        icon: Store,
                        tag: "CATALOG",
                      },
                      {
                        title: "View All Partners/Services",
                        subtitle: "Explore verified shops and service points",
                        href: "/directory",
                        icon: Globe,
                        tag: "DIRECTORY",
                      },
                    ].map((item) => (
                      <Link
                        key={item.title}
                        to={item.href}
                        className="group rounded-2xl bg-emerald-950/78 border border-emerald-100/30 backdrop-blur px-4 py-3 text-white shadow-[0_14px_30px_rgba(0,0,0,0.35)] hover:bg-emerald-950/86 hover:border-amber-200/50 transition-colors"
                        data-testid={`landing-corporate-access-${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-display font-bold text-[0.96rem] md:text-[1.02rem] leading-tight tracking-tight line-clamp-1">{item.title}</p>
                            <p className="mt-1 text-[11px] md:text-xs text-emerald-50/98 line-clamp-1">{item.subtitle}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="rounded-full bg-amber-300 text-emerald-950 px-2.5 py-1 text-[9px] md:text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                              {item.tag}
                            </span>
                            <div className="w-8 h-8 rounded-xl bg-emerald-950/70 border border-emerald-100/35 flex items-center justify-center group-hover:bg-emerald-950 transition-colors">
                              <item.icon className="w-4 h-4" />
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>

                  <div className="mt-auto rounded-xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-emerald-100/90 font-semibold">Business Ready Platform</p>
                    <div className="mt-2 flex items-center justify-between gap-3 text-white">
                      <p className="text-sm md:text-[15px] font-semibold leading-tight">Registration, commerce, and partner discovery aligned in one workflow.</p>
                      <ArrowRight className="w-4 h-4 text-amber-300 shrink-0" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <div id="products" className="mt-16 rounded-[2rem] border border-emerald-900/10 bg-white/90 backdrop-blur p-4 md:p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)]" data-testid="hero-best-products-grid">
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

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2 md:gap-3">
          {(hasBestProducts ? bestProducts : Array.from({ length: LANDING_TOP_PRODUCTS_LIMIT })).map((p, i) => (
            <Link
              key={p?.id || p?.name || i}
              to="/shop"
              className="group rounded-xl overflow-hidden border border-slate-200 bg-slate-50 hover:bg-white hover:shadow-md transition-all"
              data-testid={`hero-best-product-${i + 1}`}
            >
              <div className="aspect-[5/4] bg-slate-100 overflow-hidden">
                <img
                  src={pickProductImageSrc(p) || FALLBACK_PRODUCT_IMG}
                  alt={p?.name || "METHO Product"}
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                  loading="lazy"
                  onError={(e) => { applyLandingImageFallback(e, [pickProductImageSrc(p)]); }}
                />
              </div>
              <div className="px-2.5 py-2">
                <p className="text-[11px] md:text-xs font-semibold text-emerald-950 line-clamp-1">{p?.name || `Best Product ${i + 1}`}</p>
              </div>
            </Link>
          ))}
        </div>

        <Link to="/shop" data-testid="hero-best-products-view-all-mobile" className="md:hidden inline-flex mt-4">
          <Button variant="outline" className="rounded-full border-emerald-900/20 hover:bg-emerald-50 hover:text-emerald-900 w-full">
            View All Products <ChevronRight className="ml-1 w-4 h-4" />
          </Button>
        </Link>
      </div>
    </div>
  </section>
  );
};

const Features = () => {
  const { settings } = useSettings();
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

  useEffect(() => {
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
  }, [featuredStoreIds]);

  if (!showMethoStore) return null;

  return (
    <section id="features" className="py-24 bg-[linear-gradient(180deg,#ffffff_0%,#f4faf7_100%)]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">METHO Store</p>
          <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950">
            Live store listings from admin setup.
            <span className="text-amber-500 italic"> Auto listed in rows.</span>
          </h2>
          <p className="mt-4 text-slate-600 font-body">Whenever admin creates or updates a Metho Store, this section automatically shows the latest store listings.</p>
        </div>
        <div className="mt-10 rounded-3xl border border-emerald-900/10 bg-white/90 p-4 md:p-5 shadow-sm">
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
                          src={store.banner_url || store.logo_url}
                          alt={store.store_name || store.business_name || "METHO Store"}
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                          loading="lazy"
                          onError={(e) => {
                            if (e.currentTarget.src !== FALLBACK_PRODUCT_IMG) {
                              e.currentTarget.src = FALLBACK_PRODUCT_IMG;
                            }
                          }}
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
      </div>
    </section>
  );
};

const BusinessPlan = () => {
  const { settings } = useSettings();
  const mission = (settings?.mission_statement || "").trim() || DEFAULT_POLICY.mission_statement;
  const vision = (settings?.vision_statement || "").trim() || DEFAULT_POLICY.vision_statement;

  return (
    <section id="plan" className="py-24 bg-gradient-to-b from-emerald-950 to-emerald-900 text-white relative overflow-hidden">
      <div className="absolute inset-0 grain opacity-30" />
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs uppercase tracking-[0.25em] text-amber-400 font-semibold">Our Foundation</p>
          <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight">
            Mission and Vision
            <br />
            <span className="text-amber-400">that drive METHO.</span>
          </h2>
        </div>

        <div className="mt-10 grid md:grid-cols-2 gap-5">
            <div className="rounded-2xl border border-white/15 bg-white/10 backdrop-blur p-6">
              <p className="text-[10px] uppercase tracking-[0.24em] text-amber-300 font-semibold">Mission</p>
              <p className="mt-3 text-sm md:text-base text-emerald-100/90 whitespace-pre-line font-body leading-relaxed">{mission}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 backdrop-blur p-6">
              <p className="text-[10px] uppercase tracking-[0.24em] text-amber-300 font-semibold">Vision</p>
              <p className="mt-3 text-sm md:text-base text-emerald-100/90 whitespace-pre-line font-body leading-relaxed">{vision}</p>
            </div>
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

const AssociatePartnerFinder = () => {
  const { settings } = useSettings();
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

  useEffect(() => {
    api.get("/directory/cities").then((r) => setCities(Array.isArray(r.data) ? r.data : [])).catch(() => setCities([]));
    api.get("/directory/categories").then((r) => setCategories(Array.isArray(r.data) ? r.data : [])).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    const q = [nameQuery, serviceQuery].map((v) => String(v || "").trim()).filter(Boolean).join(" ").trim();
    if (q) params.set("q", q);
    if (city) params.set("city", city);
    if (pincode) params.set("pincode", pincode);
    if (businessType && businessType !== "All") params.set("business_type", businessType);
    if (category) params.set("category", category);

    setLoading(true);
    api.get(`/directory/partners?${params.toString()}`)
      .then((r) => {
        const rows = Array.isArray(r.data) ? r.data : [];
        const hasSearchFilters = Boolean(q || city || pincode || (businessType && businessType !== "All") || category);
        if (hasSearchFilters) {
          setResults(rows.slice(0, 6));
          return;
        }
        const keyOf = (item) => String(item?.id || item?.partner_code || "").trim();
        const byId = new Map(rows.map((item) => [keyOf(item), item]));
        const selected = featuredPartnerIds.map((id) => byId.get(id)).filter(Boolean);
        setResults((selected.length > 0 ? selected : rows).slice(0, 4));
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [nameQuery, city, pincode, businessType, serviceQuery, category, featuredPartnerIds]);

  useEffect(() => {
    const pin = normalizePincode(pincode);
    if (!isCompletePincode(pin)) return;
    api.get(`/directory/pincode-lookup?pincode=${encodeURIComponent(pin)}`)
      .then((r) => {
        const nextCity = String(r?.data?.city || "").trim();
        if (nextCity) setCity(nextCity);
      })
      .catch(() => {});
  }, [pincode]);

  if (!showPartnerShop) return null;

  return (
    <section id="partner-finder" className="py-16 bg-gradient-to-b from-white to-emerald-50/35" data-testid="landing-associate-partner-finder">
      <div className="max-w-7xl mx-auto px-6">
        <div className="relative rounded-3xl overflow-hidden">
          {directoryHero ? (
            <div
              className="absolute inset-0 bg-cover bg-center opacity-10"
              style={{ backgroundImage: `url(${directoryHero})` }}
              aria-hidden="true"
            />
          ) : null}
          <div className="relative grid lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-800 text-white p-6 md:p-7 shadow-xl shadow-emerald-900/20">
            <p className="text-[10px] uppercase tracking-[0.28em] text-amber-300 font-bold">Associate Partner</p>
            <h3 className="mt-2 font-display font-black text-3xl leading-tight">Find partner shops and services near you</h3>
            <p className="mt-3 text-sm text-emerald-100/85 font-body">
              Search by city, category, business type or service name. Every listing is built for fast discovery and direct shopping.
            </p>
            <div className="mt-5 space-y-2 text-xs text-emerald-100/85 font-semibold">
              <p>• Verified partner listings</p>
              <p>• City-wise filtering in seconds</p>
              <p>• Direct visit and order flow</p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/directory" className="inline-flex" data-testid="landing-find-partner-open-directory">
                <Button className="rounded-full bg-amber-400 text-emerald-950 hover:bg-amber-500 font-bold">
                  Open Partner Directory <ChevronRight className="ml-1 w-4 h-4" />
                </Button>
              </Link>
              <Link to="/directory" className="inline-flex" data-testid="landing-find-partner-open-all-partners">
                <Button variant="outline" className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white/20 font-bold">
                  View All Partner Services <ChevronRight className="ml-1 w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>

          <div className="lg:col-span-8 rounded-3xl border border-emerald-300/70 bg-gradient-to-br from-emerald-100 via-emerald-50 to-amber-50/50 p-4 md:p-5 shadow-md">
            <div className="grid md:grid-cols-2 xl:grid-cols-6 gap-2.5 rounded-2xl border border-emerald-300/70 bg-gradient-to-r from-emerald-100/90 via-emerald-50/95 to-amber-50/85 p-3 shadow-inner">
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

            <div className="mt-3 rounded-2xl border border-emerald-200/70 bg-gradient-to-b from-emerald-50/65 to-white p-3 min-h-[214px] shadow-inner">
              {loading ? (
                <p className="text-sm text-slate-500">Searching verified partner shops...</p>
              ) : results.length === 0 ? (
                <p className="text-sm text-slate-500">No matching partner found. Try a nearby city or a broader category.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {results.map((p) => (
                    <Link
                      key={p.id || p.partner_code}
                      to={`/partner-shop/${p.partner_code}`}
                      className="rounded-xl border border-emerald-300/45 bg-emerald-100/65 hover:bg-emerald-100 p-3 shadow-sm transition-colors"
                      data-testid={`landing-partner-result-${p.partner_code}`}
                    >
                      <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">{p.partner_code}</p>
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
  const placeholder = settings?.product_placeholder_image_url_full || FALLBACK_PRODUCT_IMG;
  const [products, setProducts] = React.useState([]);
  useEffect(() => {
    api.post("/seed").catch(() => {});
    api.get("/products?limit=40").then((r) => setProducts(normalizeCollection(r.data).filter(isVisibleMethoProduct).slice(0, 4))).catch(() => {});
  }, []);
  return (
    <section id="products" className="relative py-24 overflow-hidden bg-[radial-gradient(circle_at_10%_20%,rgba(16,185,129,0.12),transparent_38%),radial-gradient(circle_at_90%_0%,rgba(245,158,11,0.14),transparent_42%),linear-gradient(180deg,#f8faf9_0%,#eef7f2_100%)]">
      <div className="absolute inset-0 grain opacity-20" />
      <div className="absolute left-6 top-8 md:left-14 md:top-12 rounded-2xl border border-emerald-900/10 bg-white/80 backdrop-blur px-3 py-2 shadow-sm">
        <p className="text-[10px] uppercase tracking-[0.24em] text-emerald-800 font-semibold">METHO Product Browser</p>
      </div>
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">METHO Products</p>
            <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950">
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
        <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4">
          {products.map((p, i) => (
            <Link
              key={p.id}
              to={p?.name ? `/shop?q=${encodeURIComponent(p.name)}` : "/shop"}
              className="group block bg-white/95 backdrop-blur rounded-2xl overflow-hidden border border-emerald-900/10 hover:shadow-xl hover:shadow-emerald-900/10 transition-all"
              data-testid={`product-card-${i}`}
            >
              <div className="aspect-square overflow-hidden bg-gradient-to-br from-white to-emerald-50/40">
                <img
                  src={pickProductImageSrc(p) || placeholder}
                  alt={p.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  onError={(e) => { applyLandingImageFallback(e, [pickProductImageSrc(p)], placeholder || FALLBACK_PRODUCT_IMG); }}
                />
              </div>
              <div className="p-4">
                <p className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold">{p.category}</p>
                <h4 className="mt-1 font-display font-bold text-emerald-950 line-clamp-1">{p.name}</h4>
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-display font-black text-lg text-emerald-950">₹{p.price}</span>
                  {p.product_type === "associate_partner" ? (
                    <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-semibold">Partner</span>
                  ) : (
                    <span className="text-xs bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full font-semibold">METHO</span>
                  )}
                </div>
                <div className="mt-3">
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
    <section className="py-16 bg-gradient-to-b from-white to-amber-50/45" data-testid="top-leaders-section">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">Top Leaders</p>
          <h2 className="mt-2 font-display font-black text-3xl md:text-4xl tracking-tight text-emerald-950">Leadership Team</h2>
        </div>
        <div className="mt-8 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {leaders.map((leader, i) => (
            <div key={i} className="bg-white rounded-2xl border border-emerald-900/10 overflow-hidden shadow-sm hover:shadow-md transition-shadow" data-testid={`top-leader-card-${i + 1}`}>
              <div className="aspect-square overflow-hidden bg-secondary">
                <img
                  src={leader.image || FALLBACK_LEADER_IMG}
                  alt={leader.name}
                  data-original-src={leader.image || ""}
                  data-has-custom={leader.image ? "1" : "0"}
                  className="w-full h-full object-cover"
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
              <div className="p-3 bg-emerald-50/45 border-t border-emerald-100">
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
  const mission = (settings?.mission_statement || "").trim() || DEFAULT_POLICY.mission_statement;
  const vision = (settings?.vision_statement || "").trim() || DEFAULT_POLICY.vision_statement;
  const returnPolicy = (settings?.return_policy || "").trim() || DEFAULT_POLICY.return_policy;

  return (
    <section id="return-policy" className="py-10 bg-white" data-testid="landing-return-policy-box">
      <div className="max-w-6xl mx-auto px-6">
        <div className="rounded-2xl border border-emerald-900/10 bg-gradient-to-br from-white to-emerald-50/40 p-6 md:p-7 shadow-sm">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">Mission, Vision & Return Policy</p>
          <div className="mt-4 grid md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-emerald-100 bg-white/85 p-4">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Mission</p>
              <p className="mt-2 text-sm text-slate-700 whitespace-pre-line font-body leading-relaxed">{mission}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-white/85 p-4">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Vision</p>
              <p className="mt-2 text-sm text-slate-700 whitespace-pre-line font-body leading-relaxed">{vision}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-white/85 p-4">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Return Policy</p>
              <p className="mt-2 text-sm text-slate-700 whitespace-pre-line font-body leading-relaxed">{returnPolicy}</p>
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

const Footer = () => (
  <footer className="bg-emerald-950 text-emerald-100/80 py-14">
    <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-4 gap-10">
      <div className="md:col-span-2">
        <Logo showTagline />
        <p className="mt-4 max-w-sm text-sm font-body">India's most powerful business platform. Built by Metho Logistics Private Limited for the growing Partner community.</p>
        <div className="mt-4 flex items-center gap-3 text-xs">
          <Building2 className="w-4 h-4" /> Metho Logistics Private Limited
        </div>
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
      <p className="flex items-center gap-2"><Globe className="w-3 h-3" /> Powered by METHO Logistics ERP v3.0</p>
    </div>
  </footer>
);

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background" data-testid="landing-page">
      <Nav />
      <ReferralEntryStrip />
      <Hero />
      <AssociatePartnerFinder />
      <Features />
      <BusinessPlan />
      <TopLeaders />
      <ReturnPolicyBox />
      <Footer />
    </div>
  );
}


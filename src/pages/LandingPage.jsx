import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, TrendingUp, Users, Wallet, Shield, Award, Sparkles, Check, ChevronRight, Star, Building2, Zap, Globe, MapPin, Store, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import RewardEngineFlow from "@/components/RewardEngineFlow";
import api from "@/services/api";
import { useSettings } from "@/contexts/SettingsContext";

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
const DEFAULT_LEADER_IMG_1 = "https://images.pexels.com/photos/7581113/pexels-photo-7581113.jpeg?auto=compress&cs=tinysrgb&w=700";
const DEFAULT_LEADER_IMG_2 = "https://images.pexels.com/photos/7580791/pexels-photo-7580791.jpeg?auto=compress&cs=tinysrgb&w=700";
const DEFAULT_LEADER_IMG_3 = "https://images.pexels.com/photos/7580821/pexels-photo-7580821.jpeg?auto=compress&cs=tinysrgb&w=700";
const FALLBACK_PRODUCT_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'><rect width='600' height='600' fill='%23f1f5f9'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23475569' font-size='26' font-family='Arial'>METHOO STORE Product</text></svg>";
const FALLBACK_LEADER_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 700 875'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0%25' stop-color='%23f8fafc'/><stop offset='100%25' stop-color='%23e2e8f0'/></linearGradient></defs><rect width='700' height='875' fill='url(%23g)'/><circle cx='350' cy='305' r='104' fill='%2394a3b8' opacity='0.42'/><rect x='170' y='430' width='360' height='280' rx='180' fill='%2394a3b8' opacity='0.35'/><rect x='0' y='760' width='700' height='115' fill='%23cbd5e1' opacity='0.4'/></svg>";
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
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-2">
      <Logo showTagline />
      <nav className="hidden md:flex items-center gap-8 font-body text-sm">
        <a href="#features" className="text-slate-700 hover:text-emerald-900 transition-colors">Features</a>
        <a href="#plan" className="text-slate-700 hover:text-emerald-900 transition-colors">Business Plan</a>
        <a href="#engine" className="text-slate-700 hover:text-emerald-900 transition-colors">Engine</a>
        <a href="#products" className="text-slate-700 hover:text-emerald-900 transition-colors">Products</a>
        <a href="#faq" className="text-slate-700 hover:text-emerald-900 transition-colors">FAQ</a>
      </nav>
      <div className="flex items-center gap-2">
        <Link to="/metho-store" className="md:hidden" data-testid="nav-mobile-metho-store-link">
          <Button variant="ghost" size="sm" className="px-2 hover:bg-emerald-50 hover:text-emerald-900">View Metho Store</Button>
        </Link>
        <Link to="/partner-register" className="hidden md:inline-flex" data-testid="nav-partner-register-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">Partner Register</Button>
        </Link>
        <Link to="/metho-store" className="hidden md:inline-flex" data-testid="nav-metho-store-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">View Metho Store</Button>
        </Link>
        <Link to="/install" className="hidden md:inline-flex" data-testid="nav-install-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">Install App</Button>
        </Link>
        <Link to="/login" className="hidden md:inline-flex" data-testid="nav-partner-login-link">
          <Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900">Partner Login</Button>
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
  const HERO_IMG = settings?.landing_hero_image_url_full || DEFAULT_HERO_IMG;
  const tagline = settings?.landing_tagline;
  const subheading = settings?.landing_subheading;

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
              Aay hobe. <span className="text-amber-500 italic">Upay hobe.</span>
              <br />
              <span className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800">Your Income. Our System.</span>
            </h1>
          )}
          {subheading ? (
            <p className="mt-6 max-w-xl text-lg text-slate-600 font-body leading-relaxed">{subheading}</p>
          ) : (
            <p className="mt-6 max-w-2xl text-lg text-slate-600 font-body leading-relaxed">
              METHOO STORE™ is India's most powerful direct-selling business platform — engineered for Partners, Leaders and Members.<br />
              <span className="text-slate-500 text-base">A corporate office-ready earning ecosystem with genealogy, wallet, Smart Cycle and commission intelligence in one place.</span>
            </p>
          )}
          <div className="mt-6 grid gap-3 sm:grid-cols-3 max-w-2xl">
            {[
              "Corporate onboarding flow",
              "India-ready payout system",
              "Smart team growth engine",
            ].map((item) => (
              <div key={item} className="rounded-xl border border-emerald-900/10 bg-white/80 backdrop-blur px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
                {item}
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/register" data-testid="hero-cta-register">
              <Button size="lg" className="bg-gradient-to-r from-emerald-900 to-emerald-800 hover:from-emerald-950 hover:to-emerald-900 text-white rounded-full px-7 h-12 text-base font-semibold w-full sm:w-auto shadow-lg shadow-emerald-900/20">
                Register Free — in 60 seconds <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
            <Link to="/partner-register" className="hidden sm:inline-flex" data-testid="hero-cta-partner-register">
              <Button size="lg" variant="outline" className="rounded-full px-7 h-12 text-base border-emerald-900/20 hover:bg-emerald-50 hover:text-emerald-900">
                Partner Register <Building2 className="ml-1 w-4 h-4" />
              </Button>
            </Link>
            <Link to="/login" className="hidden sm:inline-flex" data-testid="hero-cta-partner-login">
              <Button size="lg" variant="outline" className="rounded-full px-7 h-12 text-base border-emerald-900/20 hover:bg-emerald-50 hover:text-emerald-900">
                Partner Login <ChevronRight className="ml-1 w-4 h-4" />
              </Button>
            </Link>
            <Link to="/shop" data-testid="hero-cta-shop">
              <Button size="lg" variant="outline" className="rounded-full px-7 h-12 text-base border-emerald-900/20 hover:bg-emerald-50 hover:text-emerald-900">
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
                  className="pl-9 h-12 rounded-full border-emerald-900/20 bg-white"
                  data-testid="hero-shop-search-input"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-full border-emerald-900/20 hover:bg-emerald-50 hover:text-emerald-900"
                onClick={openShopWithSearch}
                data-testid="hero-shop-search-button"
              >
                <Search className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="mt-10 flex items-center gap-6">
            <div className="flex -space-x-2">
              {[TEAM_IMG, HERO_IMG, WALLET_IMG].map((src, i) => (
                <div key={i} className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-emerald-100">
                  <img src={src} alt="member" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-center gap-1 text-amber-500">
                {[1,2,3,4,5].map(i => <Star key={i} className="w-4 h-4 fill-current" />)}
              </div>
              <p className="text-xs text-slate-500 font-body mt-0.5">Trusted by growing partner offices across India</p>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.2 }} className="lg:col-span-5 relative">
          <div className="relative">
            <div className="absolute -top-4 -left-4 w-28 h-28 bg-amber-300/30 rounded-full blur-3xl" />
            <div className="absolute -bottom-4 -right-4 w-40 h-40 bg-emerald-500/15 rounded-full blur-3xl" />
            <div className="absolute -left-3 top-10 bottom-10 w-1.5 rounded-full bg-gradient-to-b from-[#ff9933] via-white to-[#138808]" />
            <div className="relative rounded-[28px] overflow-hidden shadow-2xl border border-emerald-900/10 bg-white p-3">
              <div className="relative h-[480px] rounded-[22px] overflow-hidden bg-emerald-950">
                <img src={NETWORK_IMG} alt="Associate partner network" className="absolute inset-0 w-full h-full object-cover opacity-15" />
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950" />

                <div className="relative z-10 p-5 h-full flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.28em] text-amber-300 font-bold">Associate Partner Network</p>
                      <h3 className="mt-2 font-display font-black text-2xl text-white leading-tight">Professional shops, trusted offices, one earning ecosystem.</h3>
                    </div>
                    <div className="rounded-2xl bg-white/10 border border-white/15 p-3 text-white shrink-0">
                      <Store className="w-6 h-6" />
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3">
                    {[
                      { name: "METHO Associate Desk", place: "Kolkata Office Belt", tag: "Featured Partner" },
                      { name: "AAY Partner Hub", place: "Howrah Trade Circle", tag: "Fast Moving Products" },
                      { name: "Upay Business Point", place: "North 24 Parganas", tag: "Member Reward Ready" },
                    ].map((partner) => (
                      <div key={partner.name} className="rounded-2xl bg-white/10 border border-white/10 backdrop-blur px-4 py-3 text-white">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-display font-bold text-base leading-tight">{partner.name}</p>
                            <p className="mt-1 text-xs text-emerald-100/80 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-amber-300" /> {partner.place}</p>
                          </div>
                          <span className="shrink-0 rounded-full bg-amber-300 text-emerald-950 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">{partner.tag}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-auto grid grid-cols-2 gap-3">
                    <div className="bg-white/95 backdrop-blur rounded-xl p-4 border border-white/50 shadow-lg">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-800 font-semibold">This Month</p>
                      <p className="font-display font-black text-2xl text-emerald-950">₹4,82,340</p>
                      <p className="text-xs text-slate-500">Total METHO Office Sales</p>
                    </div>
                    <div className="bg-white/95 backdrop-blur rounded-xl p-4 border border-white/50 shadow-lg">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-800 font-semibold">Network Ready</p>
                      <p className="font-display font-black text-2xl text-emerald-950">500+</p>
                      <p className="text-xs text-slate-500">Associate-friendly products</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { n: "500+", l: "Active Partners" },
          { n: "2K+", l: "Members" },
          { n: "500+", l: "Products" },
          { n: "28", l: "States Covered" },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl bg-gradient-to-br from-white to-slate-50 border border-emerald-900/8 p-5 hover:shadow-md transition-shadow">
            <p className="font-display font-black text-3xl text-emerald-950">{s.n}</p>
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500 mt-1">{s.l}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
  );
};

const Features = () => {
  const items = [
    { icon: Users, title: "Genealogy Tree", desc: "Interactive downline visualization with unlimited depth.", span: "md:col-span-5" },
    { icon: Wallet, title: "Smart Wallet", desc: "Real-time income, rewards & withdrawal via UPI / IMPS / Bank.", span: "md:col-span-3" },
    { icon: TrendingUp, title: "Smart Cycle™ Engine", desc: "Auto 5-week qualification & 10% bonus payout on METHO sales.", span: "md:col-span-4" },
    { icon: Shield, title: "MPS Shield™ Fund", desc: "10% of every commission builds your safety-net balance.", span: "md:col-span-4" },
    { icon: Award, title: "Leader Match Reward™", desc: "Sponsors earn 50% of downline's Smart Cycle Bonus — paid separately.", span: "md:col-span-4" },
    { icon: Zap, title: "Instant Payouts", desc: "Same-day withdrawal processing.", span: "md:col-span-4" },
  ];
  return (
    <section id="features" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">The Engine</p>
          <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950">
            Not just a dashboard.
            <br />
            <span className="text-amber-500 italic">A calculation engine.</span>
          </h2>
          <p className="mt-4 text-slate-600 font-body">Every rupee tracked. Every level rewarded. Every cycle automated.</p>
        </div>
        <div className="mt-12 grid grid-cols-1 md:grid-cols-12 gap-4">
          {items.map((f, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className={`${f.span} group rounded-2xl border border-border bg-secondary/30 hover:bg-secondary p-7 hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-default`}
              data-testid={`feature-card-${i}`}
            >
              <div className="w-11 h-11 rounded-lg bg-emerald-900 flex items-center justify-center mb-4 group-hover:bg-amber-500 transition-colors">
                <f.icon className="w-5 h-5 text-amber-400 group-hover:text-emerald-950 transition-colors" />
              </div>
              <h3 className="font-display font-bold text-xl text-emerald-950">{f.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600 font-body leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const BusinessPlan = () => (
  <section id="plan" className="py-24 bg-gradient-to-b from-emerald-950 to-emerald-900 text-white relative overflow-hidden">
    <div className="absolute inset-0 grain opacity-30" />
    <div className="max-w-7xl mx-auto px-6 relative">
      <div className="grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-amber-400 font-semibold">The Business Plan</p>
          <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight">
            Personal Smart Cycle.
            <br />
            <span className="text-amber-400">Real payouts.</span>
          </h2>
          <div className="mt-8 space-y-4">
            {[
              { t: "Personal Smart Cycle™", d: "Every METHO purchase starts your 5-week cycle. Bonus Week pays 10% of qualified sales." },
              { t: "Leader Match Reward™", d: "Whenever a direct member earns a Smart Cycle Bonus, you receive 50% Leader Match — paid separately by the company." },
              { t: "Member Value Reward™", d: "50% of every partner commission flows back to you as Value Points." },
              { t: "Elite Leader Reward™", d: "30% of your team's partner commissions build your Elite Leader balance." },
              { t: "MPS Shield™ Fund", d: "10% goes into your safety-net fund — automatic protection on every order." },
              { t: "Associate Partner Network", d: "Shop across our approved partners. Earns Value + MPS (independent from Smart Cycle)." },
            ].map((it, i) => (
              <div key={i} className="flex gap-4 group" data-testid={`plan-item-${i}`}>
                <div className="w-9 h-9 rounded-full bg-amber-400 text-emerald-950 flex items-center justify-center font-display font-black text-sm shrink-0 group-hover:scale-110 transition-transform">
                  {i+1}
                </div>
                <div>
                  <h4 className="font-display font-bold text-lg">{it.t}</h4>
                  <p className="text-emerald-100/80 text-sm font-body">{it.d}</p>
                </div>
              </div>
            ))}
          </div>
          <Link to="/register" className="mt-10 inline-block" data-testid="plan-cta-register">
            <Button size="lg" className="bg-amber-400 hover:bg-amber-500 text-emerald-950 rounded-full px-8 h-12 font-bold">
              Join The Plan <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
        </div>
        <div className="relative">
          <div className="rounded-2xl overflow-hidden border border-amber-400/20 shadow-2xl">
            <img src={NETWORK_IMG} alt="Network visualization" className="w-full h-[520px] object-cover" />
          </div>
          <div className="absolute -bottom-6 -left-6 bg-white rounded-xl p-4 shadow-xl border border-border w-56">
            <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-800 font-semibold">Rank Status</p>
            <p className="font-display font-black text-2xl text-emerald-950 mt-1">Diamond</p>
            <div className="mt-2 h-1.5 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-400 to-amber-500 w-[82%]" />
            </div>
            <p className="text-xs text-slate-500 mt-1.5 font-body">82% to next reward</p>
          </div>
        </div>
      </div>
    </div>
  </section>
);

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
  const [cities, setCities] = React.useState([]);
  const [categories, setCategories] = React.useState([]);
  const [results, setResults] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  const [nameQuery, setNameQuery] = React.useState("");
  const [city, setCity] = React.useState("");
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
    if (businessType && businessType !== "All") params.set("business_type", businessType);
    if (category) params.set("category", category);

    setLoading(true);
    api.get(`/directory/partners?${params.toString()}`)
      .then((r) => setResults(Array.isArray(r.data) ? r.data.slice(0, 6) : []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [nameQuery, city, businessType, serviceQuery, category]);

  return (
    <section className="py-16 bg-white" data-testid="landing-associate-partner-finder">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-950 to-emerald-900 text-white p-6 md:p-7">
            <p className="text-[10px] uppercase tracking-[0.28em] text-amber-300 font-bold">Associate Partner</p>
            <h3 className="mt-2 font-display font-black text-3xl leading-tight">View Associate Partner</h3>
            <p className="mt-3 text-sm text-emerald-100/85 font-body">
              Name, city, business type, service বা category দিয়ে partner shop খুঁজুন।
            </p>
            <div className="mt-5 space-y-2 text-xs text-emerald-100/85 font-semibold">
              <p>• Verified partner listings</p>
              <p>• Fast city-wise search</p>
              <p>• Direct shop visit and order</p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/directory" className="inline-flex" data-testid="landing-find-partner-open-directory">
                <Button className="rounded-full bg-amber-400 text-emerald-950 hover:bg-amber-500 font-bold">
                  Open Full Partner Directory <ChevronRight className="ml-1 w-4 h-4" />
                </Button>
              </Link>
              <Link to="/directory" className="inline-flex" data-testid="landing-find-partner-open-all-partners">
                <Button variant="outline" className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white/20 font-bold">
                  View All Partner Services <ChevronRight className="ml-1 w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>

          <div className="lg:col-span-8 rounded-3xl border border-emerald-900/10 bg-slate-50 p-4 md:p-5">
            <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-2.5">
              <div className="xl:col-span-2 relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={nameQuery}
                  onChange={(e) => setNameQuery(e.target.value)}
                  placeholder="Name / Partner / Shop"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200"
                  data-testid="landing-partner-search-name"
                />
              </div>

              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200"
                data-testid="landing-partner-search-city"
              >
                <option value="">All city</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>

              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200"
                data-testid="landing-partner-search-business"
              >
                {ASSOCIATE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>

              <input
                value={serviceQuery}
                onChange={(e) => setServiceQuery(e.target.value)}
                placeholder="Service"
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200"
                data-testid="landing-partner-search-service"
              />

              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200"
                data-testid="landing-partner-search-category"
              >
                <option value="">All category</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 min-h-[214px]">
              {loading ? (
                <p className="text-sm text-slate-500">Searching partner shops...</p>
              ) : results.length === 0 ? (
                <p className="text-sm text-slate-500">No partner found for current filters.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {results.map((p) => (
                    <Link
                      key={p.id || p.partner_code}
                      to={`/partner-shop/${p.partner_code}`}
                      className="rounded-xl border border-emerald-900/10 bg-emerald-50/40 hover:bg-emerald-50 p-3 transition-colors"
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
    </section>
  );
};

const Products = () => {
  const [products, setProducts] = React.useState([]);
  useEffect(() => {
    api.post("/seed").catch(() => {});
    api.get("/products").then(r => setProducts(r.data.filter(p => p.product_type === "metho").slice(0, 4))).catch(() => {});
  }, []);
  return (
    <section id="products" className="py-24 bg-secondary/40">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">Product Universe</p>
            <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950">
              Premium products.
              <br />
              <span className="text-amber-500 italic">Real ₹ Sales. Real earnings.</span>
            </h2>
          </div>
          <Link to="/shop" data-testid="products-view-all">
            <Button variant="outline" className="rounded-full border-emerald-900/20 hover:bg-emerald-50 hover:text-emerald-900">
              View All Products <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
        </div>
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4">
          {products.map((p, i) => (
            <div key={p.id} className="group bg-white rounded-xl overflow-hidden border border-border hover:shadow-lg transition-all" data-testid={`product-card-${i}`}>
              <div className="aspect-square overflow-hidden bg-secondary">
                <img
                  src={p.image_url || FALLBACK_PRODUCT_IMG}
                  alt={p.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  onError={(e) => { if (e.currentTarget.src !== FALLBACK_PRODUCT_IMG) e.currentTarget.src = FALLBACK_PRODUCT_IMG; }}
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
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const TopLeaders = () => {
  const { settings } = useSettings();
  const leaders = [
    {
      name: settings?.top_leader_1_name || "Top Leader 1",
      title: settings?.top_leader_1_title || "National Achiever",
      image: settings?.top_leader_1_image_url_full,
      defaultImage: DEFAULT_LEADER_IMG_1,
    },
    {
      name: settings?.top_leader_2_name || "Top Leader 2",
      title: settings?.top_leader_2_title || "Regional Achiever",
      image: settings?.top_leader_2_image_url_full,
      defaultImage: DEFAULT_LEADER_IMG_2,
    },
    {
      name: settings?.top_leader_3_name || "Top Leader 3",
      title: settings?.top_leader_3_title || "Fastest Growing Leader",
      image: settings?.top_leader_3_image_url_full,
      defaultImage: DEFAULT_LEADER_IMG_3,
    },
  ];

  return (
    <section className="py-24 bg-gradient-to-b from-white to-amber-50/50" data-testid="top-leaders-section">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">Company Management Achievers</p>
          <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950">
            Top Leaders
            <br />
            <span className="text-amber-500 italic">who inspire growth.</span>
          </h2>
        </div>
        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
          {leaders.map((leader, i) => (
            <div key={i} className="bg-white rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-lg transition-shadow" data-testid={`top-leader-card-${i + 1}`}>
              <div className="aspect-[4/5] overflow-hidden bg-secondary">
                <img
                  src={leader.image || leader.defaultImage || FALLBACK_LEADER_IMG}
                  alt={leader.name}
                  data-default-src={leader.defaultImage || ""}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const img = e.currentTarget;
                    const defaultSrc = img.dataset.defaultSrc || "";
                    if (defaultSrc && img.dataset.usedDefault !== "1" && img.src !== defaultSrc) {
                      img.dataset.usedDefault = "1";
                      img.src = defaultSrc;
                      return;
                    }
                    if (img.src !== FALLBACK_LEADER_IMG) img.src = FALLBACK_LEADER_IMG;
                  }}
                />
              </div>
              <div className="p-5">
                <p className="font-display font-black text-2xl text-emerald-950">{leader.name}</p>
                <p className="mt-1 text-sm text-amber-700 font-semibold tracking-wide uppercase">{leader.title}</p>
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
  const returnPolicy = (settings?.return_policy || "").trim() || DEFAULT_POLICY.return_policy;

  return (
    <section className="py-24 bg-secondary/30" data-testid="landing-policy-section">
      <div className="max-w-6xl mx-auto px-6">
        <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold text-center">Our Commitments</p>
        <h2 className="mt-3 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950 text-center">
          Mission, Vision & Return Policy
        </h2>

        <div className="mt-10 grid md:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-border p-6">
            <p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Mission</p>
            <p className="mt-2 text-sm text-slate-700 whitespace-pre-line font-body">{mission}</p>
          </div>
          <div className="bg-white rounded-2xl border border-border p-6">
            <p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Vision</p>
            <p className="mt-2 text-sm text-slate-700 whitespace-pre-line font-body">{vision}</p>
          </div>
          <div className="bg-white rounded-2xl border border-border p-6">
            <p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Return Policy</p>
            <p className="mt-2 text-sm text-slate-700 whitespace-pre-line font-body">{returnPolicy}</p>
          </div>
        </div>
      </div>
    </section>
  );
};

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
      <RewardEngineFlow />
      <Products />
      <TopLeaders />
      <MissionVisionPolicy />
      <FAQ />
      <Footer />
    </div>
  );
}


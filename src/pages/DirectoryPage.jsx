import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, MapPin, Store, Building2, ShoppingBag, Phone, Navigation, ChevronRight, Star, MessageCircle } from "lucide-react";
import api from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { resolveAssetUrl } from "@/lib/utils";
import { isCompletePincode, normalizePincode } from "@/lib/indiaLocation";
import useDebouncedValue from "@/hooks/useDebouncedValue";

const TYPES = ["All", "Retail Shop", "Super Market", "Pharmacy", "Restaurant", "Service Provider", "Distributor", "Wholesaler", "Online Seller"];

const mapsUrl = (p) => {
  const q = [p.business_name, p.address, p.city, p.state].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};
const cleanPhone = (v) => (v || "").replace(/[^\d]/g, "");
const waUrl = (p) => {
  const n = cleanPhone(p.whatsapp_no || p.phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent("Hi, I found your shop on METHOO STORE")}` : null;
};

export default function DirectoryPage() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { settings } = useSettings();
  const [cities, setCities] = useState([]);
  const [categories, setCategories] = useState([]);
  const [partners, setPartners] = useState([]);
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [type, setType] = useState("All");
  const [category, setCategory] = useState("");
  const [serviceSector, setServiceSector] = useState("");
  const [shopSector, setShopSector] = useState("");
  const [district, setDistrict] = useState("");
  const [q, setQ] = useState("");
  const [deliveryCitySearch, setDeliveryCitySearch] = useState("");
  const [deliveryPincodeSearch, setDeliveryPincodeSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [featured, setFeatured] = useState([]);
  const debouncedCity = useDebouncedValue(city, 280);
  const debouncedPincode = useDebouncedValue(pincode, 280);
  const debouncedType = useDebouncedValue(type, 280);
  const debouncedCategory = useDebouncedValue(category, 280);
  const debouncedServiceSector = useDebouncedValue(serviceSector, 280);
  const debouncedShopSector = useDebouncedValue(shopSector, 280);
  const debouncedDistrict = useDebouncedValue(district, 280);
  const debouncedQuery = useDebouncedValue(q, 280);

  useEffect(() => {
    const quick = String(searchParams.get("quick") || "").trim().toLowerCase();
    const queryQ = String(searchParams.get("q") || "").trim();
    const queryType = String(searchParams.get("business_type") || "").trim();
    const queryCategory = String(searchParams.get("category") || "").trim();
    const queryServiceSector = String(searchParams.get("service_sector") || "").trim();
    const queryShopSector = String(searchParams.get("shop_sector") || "").trim();
    const queryDistrict = String(searchParams.get("district") || "").trim();
    const queryCity = String(searchParams.get("city") || "").trim();
    const queryPincode = normalizePincode(searchParams.get("pincode") || "");

    if (queryQ || queryType || queryCategory || queryServiceSector || queryShopSector || queryDistrict || queryCity || queryPincode) {
      setQ(queryQ);
      setType(queryType || "All");
      setCategory(queryCategory);
      setServiceSector(queryServiceSector);
      setShopSector(queryShopSector);
      setDistrict(queryDistrict);
      setCity(queryCity);
      setPincode(queryPincode);
      return;
    }

    if (!quick) return;
    const quickMap = {
      products: { q: "shop", type: "Shop", shop_sector: "" },
      vegetables: { q: "shop vegetables", type: "Shop", shop_sector: "Vegetables" },
      vegetabels: { q: "shop vegetables", type: "Shop", shop_sector: "Vegetables" },
      grocery: { q: "shop grocery", type: "Shop", shop_sector: "Grocery" },
      "cosmetics-beauty": { q: "shop cosmetics beauty", type: "Shop", shop_sector: "Cosmetics & Beauty" },
      others: { q: "shop", type: "Shop", shop_sector: "Others" },
      transport: { q: "service transport", type: "Service" },
      "delivery-partner": { q: "service delivery partner", type: "Service" },
      "stay-dining": { q: "service stay dining", type: "Service" },
      "property-buy-sell": { q: "service property buy sell", type: "Service" },
      doorstep: { q: "service doorstep", type: "Service" },
      "other-services": { q: "service other services", type: "Service" },
    };
    const preset = quickMap[quick];
    if (!preset) return;
    setQ(preset.q);
    setType(preset.type);
    setCategory("");
    setServiceSector("");
    setShopSector(String(preset.shop_sector || ""));
    setDistrict("");
    setCity("");
    setPincode("");
  }, [searchParams]);

  useEffect(() => {
    api.get("/directory/cities").then(r => setCities(r.data)).catch(() => {});
    api.get("/directory/categories").then(r => setCategories(r.data)).catch(() => {});
    api.get("/directory/featured-partners").then(r => setFeatured(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedCity) params.set("city", debouncedCity);
    if (debouncedPincode) params.set("pincode", debouncedPincode);
    if (debouncedType && debouncedType !== "All") params.set("business_type", debouncedType);
    if (debouncedCategory) params.set("category", debouncedCategory);
    if (debouncedServiceSector) params.set("service_sector", debouncedServiceSector);
    if (debouncedShopSector) params.set("shop_sector", debouncedShopSector);
    if (debouncedDistrict) params.set("district", debouncedDistrict);
    if (debouncedQuery) params.set("q", debouncedQuery);
    api.get(`/directory/partners?${params.toString()}`)
      .then(r => setPartners(r.data))
      .catch(() => setPartners([]))
      .finally(() => setLoading(false));
  }, [debouncedCity, debouncedPincode, debouncedType, debouncedCategory, debouncedServiceSector, debouncedShopSector, debouncedDistrict, debouncedQuery]);

  useEffect(() => {
    const pin = normalizePincode(debouncedPincode);
    if (!isCompletePincode(pin)) return;
    api.get(`/directory/pincode-lookup?pincode=${encodeURIComponent(pin)}`)
      .then((r) => {
        const nextCity = String(r?.data?.city || "").trim();
        if (nextCity) setCity(nextCity);
      })
      .catch(() => {});
  }, [debouncedPincode]);

  const grouped = useMemo(() => {
    const map = {};
    for (const p of partners) {
      const k = p.city || "Other";
      (map[k] = map[k] || []).push(p);
    }
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }, [partners]);

  const isDeliveryFocus = String(debouncedType || "").toLowerCase() === "service"
    && String(debouncedQuery || "").toLowerCase().includes("delivery");

  const runDeliveryGlobalSearch = () => {
    const nextCity = String(deliveryCitySearch || "").trim();
    const nextPincode = normalizePincode(deliveryPincodeSearch || "");
    setType("Service");
    setQ("service delivery partner");
    setCategory("");
    setServiceSector("");
    setShopSector("");
    setDistrict("");
    setCity(nextCity);
    setPincode(nextPincode);
  };

  const clearDeliveryGlobalSearch = () => {
    setDeliveryCitySearch("");
    setDeliveryPincodeSearch("");
    setCity("");
    setPincode("");
    setType("All");
    setCategory("");
    setShopSector("");
    setQ("");
  };

  const showGrouped = !city && !pincode && !type.replace("All", "") && !category && !serviceSector && !shopSector && !district && !q;
  const deliveryComparisonRows = useMemo(() => {
    if (!isDeliveryFocus) return [];
    return [...partners]
      .filter((p) => Number.isFinite(Number(p?.delivery_min_rate)) && Number(p?.delivery_min_rate) > 0)
      .sort((a, b) => Number(a.delivery_min_rate) - Number(b.delivery_min_rate));
  }, [isDeliveryFocus, partners]);

  return (
    <div className="min-h-screen bg-slate-50" data-testid="directory-page">
      <header className="bg-emerald-950 text-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2">
          <Logo />
          <div className="flex flex-wrap justify-end gap-2">
            <Link to="/partner-register">
              <Button variant="outline" size="sm" className="border-amber-400 bg-transparent text-amber-400 hover:bg-amber-400 hover:text-emerald-950 rounded-full font-semibold px-2.5 sm:px-3 text-[11px] sm:text-sm" data-testid="dir-become-partner">
                <Store className="w-3.5 h-3.5 mr-1" /> Become a Partner
              </Button>
            </Link>
            {!user && (
              <>
                <Link to="/login"><Button variant="outline" size="sm" className="border-white/20 bg-white/10 text-white hover:bg-white/20 rounded-full px-2.5 sm:px-3 text-[11px] sm:text-sm">Sign In</Button></Link>
                <Link to="/register"><Button size="sm" className="bg-amber-400 text-emerald-950 hover:bg-amber-500 rounded-full font-semibold px-2.5 sm:px-3 text-[11px] sm:text-sm">Join</Button></Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* HERO / FILTERS */}
      <div
        className="relative bg-gradient-to-br from-emerald-950 to-emerald-800 text-white overflow-hidden"
      >
        {settings?.directory_hero_image_url_full && (
          <div
            className="absolute inset-0 opacity-25 bg-cover bg-center"
            style={{ backgroundImage: `url(${settings.directory_hero_image_url_full})` }}
          />
        )}
        <div className="max-w-6xl mx-auto px-4 py-10 relative">
          <p className="text-[10px] uppercase tracking-[0.3em] text-amber-400 font-bold">Explore · Partners</p>
          <h1 className="font-display font-black text-3xl md:text-5xl mt-2 leading-none">Shops & Businesses near you</h1>
          <p className="text-emerald-100/80 mt-3 max-w-lg font-body">
            Verified retail stores, pharmacies, restaurants and service providers across India.
            Buy online <span className="text-amber-300">or</span> visit them physically — every purchase counts towards your Smart Cycle.
          </p>

          <div className="mt-6 grid gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input placeholder="Search partner, shop or owner..." value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-9 bg-white text-slate-900" data-testid="dir-search" />
            </div>
            <Input
              value={pincode}
              onChange={(e) => setPincode(normalizePincode(e.target.value))}
              placeholder="Pincode"
              maxLength={6}
              className="h-11 bg-white text-slate-900 min-w-[120px] w-full md:w-auto font-mono"
              data-testid="dir-pincode"
            />
            <select value={city} onChange={(e) => setCity(e.target.value)} className="h-11 rounded-md border border-input px-3 bg-white text-slate-900 min-w-[140px] w-full md:w-auto" data-testid="dir-city">
              <option value="">All cities</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} className="h-11 rounded-md border border-input px-3 bg-white text-slate-900 min-w-[140px] w-full md:w-auto" data-testid="dir-type">
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-11 rounded-md border border-input px-3 bg-white text-slate-900 min-w-[140px] w-full md:w-auto" data-testid="dir-category">
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <Input value={serviceSector} onChange={(e) => setServiceSector(e.target.value)} placeholder="Service sector" className="h-11 bg-white text-slate-900 min-w-[140px] w-full md:w-auto" data-testid="dir-service-sector" />
            <Input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="District" className="h-11 bg-white text-slate-900 min-w-[120px] w-full md:w-auto" data-testid="dir-district" />
          </div>

          <div className="mt-4 rounded-xl border border-cyan-300/40 bg-cyan-500/10 p-3 md:p-4" data-testid="delivery-global-search-box">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-cyan-200 font-bold">Delivery Sector Global Search</p>
                <p className="text-xs text-cyan-100/90 mt-1">Search city or pincode to find partners who have delivery service, then open their delivery tab directly.</p>
              </div>
              <div className="grid w-full md:w-auto gap-2 md:grid-cols-[1fr_130px_auto_auto]">
                <Input
                  value={deliveryCitySearch}
                  onChange={(e) => setDeliveryCitySearch(e.target.value)}
                  placeholder="City (e.g. Rishra)"
                  className="h-10 bg-white text-slate-900"
                  data-testid="delivery-global-city"
                />
                <Input
                  value={deliveryPincodeSearch}
                  onChange={(e) => setDeliveryPincodeSearch(normalizePincode(e.target.value))}
                  placeholder="Pincode"
                  maxLength={6}
                  className="h-10 bg-white text-slate-900 font-mono"
                  data-testid="delivery-global-pincode"
                />
                <Button
                  type="button"
                  onClick={runDeliveryGlobalSearch}
                  className="h-10 rounded-full bg-cyan-600 hover:bg-cyan-700 text-white"
                  data-testid="delivery-global-search-btn"
                >
                  Search Delivery
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearDeliveryGlobalSearch}
                  className="h-10 rounded-full border-cyan-200 text-cyan-100 hover:bg-cyan-500/20"
                  data-testid="delivery-global-clear-btn"
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>

          {/* Quick city chips */}
          {cities.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="text-[10px] uppercase tracking-widest text-amber-400 font-bold self-center">Quick pick:</span>
              {cities.slice(0, 8).map(c => (
                <button
                  key={c}
                  onClick={() => setCity(city === c ? "" : c)}
                  className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-colors border ${city === c ? "bg-amber-400 text-emerald-950 border-amber-400" : "bg-white/10 text-white border-white/20 hover:bg-white/20"}`}
                  data-testid={`chip-city-${c}`}
                >
                  {c}
                </button>
              ))}
              {(city || pincode || type !== "All" || category || serviceSector || shopSector || district || q) && (
                <button
                  onClick={() => { setCity(""); setPincode(""); setType("All"); setCategory(""); setServiceSector(""); setShopSector(""); setDistrict(""); setQ(""); }}
                  className="text-xs px-3 py-1.5 rounded-full font-semibold bg-red-500/20 text-red-100 border border-red-300/30 hover:bg-red-500/30"
                  data-testid="chip-clear"
                >Clear filters</button>
              )}
            </div>
          )}
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {isDeliveryFocus && partners.length > 1 ? (
          <section className="mb-6 rounded-xl border border-cyan-200 bg-white p-4" data-testid="delivery-rate-compare-box">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-cyan-700 font-semibold">Same Area Delivery Rate Compare</p>
                <p className="text-xs text-slate-600 mt-1">একই city/pincode area-তে যাদের delivery আছে, তাদের starting rate compare করুন।</p>
              </div>
            </div>

            {deliveryComparisonRows.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-cyan-100 text-left text-xs uppercase tracking-widest text-cyan-700">
                      <th className="py-2 pr-3">Partner</th>
                      <th className="py-2 pr-3">City</th>
                      <th className="py-2 pr-3">Pincode</th>
                      <th className="py-2 pr-3">Starting Rate</th>
                      <th className="py-2 pr-3">Average</th>
                      <th className="py-2 pr-3">Max</th>
                      <th className="py-2 pr-3">Delivery Services</th>
                      <th className="py-2 pr-0">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryComparisonRows.map((p) => (
                      <tr key={`delivery-rate-${p.id}`} className="border-b border-slate-100 last:border-b-0">
                        <td className="py-2 pr-3 font-semibold text-emerald-950">{p.business_name}</td>
                        <td className="py-2 pr-3 text-slate-600">{p.city || "-"}</td>
                        <td className="py-2 pr-3 text-slate-600">{p.pincode || "-"}</td>
                        <td className="py-2 pr-3 font-bold text-emerald-900">₹{Number(p.delivery_min_rate).toLocaleString("en-IN")}</td>
                        <td className="py-2 pr-3 text-slate-700">{Number.isFinite(Number(p.delivery_avg_rate)) ? `₹${Number(p.delivery_avg_rate).toLocaleString("en-IN")}` : "-"}</td>
                        <td className="py-2 pr-3 text-slate-700">{Number.isFinite(Number(p.delivery_max_rate)) ? `₹${Number(p.delivery_max_rate).toLocaleString("en-IN")}` : "-"}</td>
                        <td className="py-2 pr-3 text-slate-700">{Number(p.delivery_service_count || 0)}</td>
                        <td className="py-2 pr-0">
                          <Link
                            to={`/gallery/${p.partner_code}?tab=delivery-partner`}
                            className="inline-flex items-center rounded-full bg-cyan-600 px-3 py-1 text-xs font-bold text-white hover:bg-cyan-700"
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-600">এই area-তে delivery partner আছে, কিন্তু compare করার মতো rate data পাওয়া যায়নি।</p>
            )}
          </section>
        ) : null}

        {/* Featured Partner of the Week */}
        {featured.length > 0 && !city && !pincode && !q && (
          <section className="mb-8" data-testid="featured-partners-section">
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-5 h-5 text-amber-500 fill-amber-400" />
              <h2 className="font-display font-black text-lg md:text-xl text-emerald-950">Featured this Week</h2>
              <span className="text-[10px] uppercase tracking-widest text-amber-700 font-bold bg-amber-100 px-2 py-0.5 rounded-full">Admin Pick</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {featured.map(p => (
                <Link
                  key={p.id}
                  to={`/partner-shop/${p.partner_code}`}
                  className="relative bg-gradient-to-br from-amber-50 to-amber-100 border-2 border-amber-400 rounded-2xl p-5 hover:shadow-xl transition-all overflow-hidden"
                  data-testid={`featured-${p.partner_code}`}
                >
                  <div className="absolute top-3 right-3 flex items-center gap-1 text-[9px] uppercase tracking-widest font-black bg-amber-400 text-emerald-950 px-2 py-1 rounded-full">
                    <Star className="w-3 h-3 fill-emerald-950" /> Featured
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-14 h-14 rounded-xl bg-emerald-950 text-amber-400 flex items-center justify-center shrink-0 overflow-hidden">
                      {p.logo_url ? <img src={resolveAssetUrl(p.logo_url)} alt="" className="w-full h-full object-cover" /> : <Building2 className="w-7 h-7" />}
                    </div>
                    <div className="min-w-0 flex-1 pr-16">
                      <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">{p.partner_code}</p>
                      <p className="font-display font-black text-emerald-950 truncate text-lg">{p.business_name}</p>
                      <p className="text-xs text-emerald-800/70 capitalize">{p.business_type}{p.city ? ` · ${p.city}` : ""}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-emerald-950/80 font-body flex items-center gap-1.5">
                    <ShoppingBag className="w-3.5 h-3.5" /> Tap to visit shop →
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {loading ? (
          <div className="text-center py-16 text-slate-500 font-body">Loading partners...</div>
        ) : partners.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-border">
            <Store className="w-10 h-10 text-slate-400 mx-auto" />
            <p className="mt-3 font-semibold text-emerald-950">No partners found</p>
            <p className="text-sm text-muted-foreground mt-1">Adjust filters or check back soon.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4 font-body">
              Found <span className="font-bold text-emerald-900">{partners.length}</span> partner{partners.length !== 1 ? "s" : ""}
              {city && <> in <span className="font-bold text-emerald-900">{city}</span></>}
              {isDeliveryFocus && <span className="ml-1 text-cyan-700 font-semibold">for Delivery Service</span>}
            </p>

            {showGrouped ? (
              grouped.map(([cityName, list]) => (
                <section key={cityName} className="mb-10">
                  <div className="flex items-baseline justify-between mb-3">
                    <h2 className="font-display font-black text-xl md:text-2xl text-emerald-950 flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-emerald-700" /> {cityName}
                      <span className="text-xs font-body font-semibold text-slate-500 ml-1">({list.length})</span>
                    </h2>
                    <button onClick={() => setCity(cityName)} className="text-xs uppercase tracking-widest font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1">
                      See all <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {list.map(p => <PartnerCard key={p.id} p={p} openDeliveryTab={isDeliveryFocus} showDeliveryRate={isDeliveryFocus} />)}
                  </div>
                </section>
              ))
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {partners.map(p => <PartnerCard key={p.id} p={p} openDeliveryTab={isDeliveryFocus} showDeliveryRate={isDeliveryFocus} />)}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function PartnerCard({ p, openDeliveryTab = false, showDeliveryRate = false }) {
  const addr = [p.address, p.city, p.state, p.pincode].filter(Boolean).join(", ");
  const wa = waUrl(p);
  const shopLink = openDeliveryTab
    ? `/gallery/${p.partner_code}?tab=delivery-partner`
    : `/partner-shop/${p.partner_code}`;
  const minRate = Number(p?.delivery_min_rate || 0);
  const maxRate = Number(p?.delivery_max_rate || 0);
  const hasRate = Number.isFinite(minRate) && minRate > 0;
  return (
    <div className="bg-white rounded-xl border border-border p-5 hover:shadow-lg hover:border-amber-400 transition-all group relative" data-testid={`partner-card-${p.partner_code}`}>
      {p.is_featured && (
        <div className="absolute top-3 right-3 flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
          <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" /> Featured
        </div>
      )}
      <Link to={shopLink} className="block">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0 overflow-hidden">
            {p.logo_url ? <img src={resolveAssetUrl(p.logo_url)} alt="" className="w-full h-full object-cover" /> : <Building2 className="w-6 h-6 text-emerald-800" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">{p.partner_code}</p>
            <p className="font-display font-bold text-emerald-950 truncate group-hover:text-emerald-700 pr-16">{p.business_name}</p>
            <p className="text-xs text-slate-500 capitalize">{p.business_type}</p>
          </div>
        </div>
        {addr && (
          <p className="text-xs text-slate-600 font-body mt-3 flex items-start gap-1.5">
            <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-700" />
            <span className="line-clamp-2">{addr}</span>
          </p>
        )}
        {showDeliveryRate ? (
          <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-2">
            {hasRate ? (
              <>
                <p className="text-[10px] uppercase tracking-widest text-cyan-700 font-semibold">Delivery Rate</p>
                <p className="text-xs text-emerald-950 font-bold mt-0.5">
                  Starting ₹{minRate.toLocaleString("en-IN")}
                  {Number.isFinite(maxRate) && maxRate > minRate ? ` · Up to ₹${maxRate.toLocaleString("en-IN")}` : ""}
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-600">Delivery rate compare data unavailable</p>
            )}
          </div>
        ) : null}
      </Link>

      <div className="mt-4 pt-3 border-t border-border grid grid-cols-4 gap-1.5">
        {p.phone ? (
          <a
            href={`tel:${p.phone}`}
            className="flex flex-col items-center gap-1 text-[10px] font-semibold text-emerald-900 hover:bg-emerald-50 rounded-lg py-2 transition"
            data-testid={`partner-call-${p.partner_code}`}
          >
            <Phone className="w-4 h-4" /> Call
          </a>
        ) : <div />}
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col items-center gap-1 text-[10px] font-semibold text-green-700 hover:bg-green-50 rounded-lg py-2 transition"
            data-testid={`partner-wa-${p.partner_code}`}
          >
            <MessageCircle className="w-4 h-4" /> Chat Owner
          </a>
        ) : <div />}
        <a
          href={mapsUrl(p)}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col items-center gap-1 text-[10px] font-semibold text-emerald-900 hover:bg-emerald-50 rounded-lg py-2 transition"
          data-testid={`partner-directions-${p.partner_code}`}
        >
          <Navigation className="w-4 h-4" /> Directions
        </a>
        <Link
          to={shopLink}
          className="flex flex-col items-center gap-1 text-[10px] font-bold text-white bg-emerald-900 hover:bg-emerald-950 rounded-lg py-2 transition"
          data-testid={`partner-shop-btn-${p.partner_code}`}
        >
          <ShoppingBag className="w-4 h-4" /> {openDeliveryTab ? "Delivery" : "Shop"}
        </Link>
      </div>
    </div>
  );
}


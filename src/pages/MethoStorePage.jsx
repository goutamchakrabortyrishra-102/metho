import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, MapPin, MessageCircle, Navigation, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { useSettings } from "@/contexts/SettingsContext";
import { methoStoreApi, normalizeCollection } from "@/services/methoStore";
import api from "@/services/api";

const mapsUrl = (partner) => {
  const q = [partner.business_name, partner.address, partner.city, partner.state].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};

const cleanPhone = (value) => (value || "").replace(/[^\d]/g, "");

const waUrl = (partner) => {
  const n = cleanPhone(partner.whatsapp_no || partner.phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(`Hi ${partner.business_name}, I found your shop on METHOO STORE`)}` : null;
};

export default function MethoStorePage() {
  const { settings } = useSettings();
  const [partners, setPartners] = useState([]);
  const [cities, setCities] = useState([]);
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/directory/cities").then((r) => setCities(r.data || [])).catch(() => setCities([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    methoStoreApi.publicListStoreListings()
      .then((data) => {
        const rows = normalizeCollection(data);
        const next = rows.filter((item) => {
          const active = (item?.is_active ?? item?.active ?? item?.approved ?? true) !== false;
          const matchesQ = !q || [item?.store_name, item?.business_name, item?.owner_code, item?.code].filter(Boolean).join(" ").toLowerCase().includes(q.toLowerCase());
          const matchesCity = !city || String(item?.city || "").toLowerCase() === String(city || "").toLowerCase();
          return active && matchesQ && matchesCity;
        });
        setPartners(next);
      })
      .catch(() => setPartners([]))
      .finally(() => setLoading(false));
  }, [q, city]);

  const resetFilters = () => {
    setQ("");
    setCity("");
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#f6f8f7_100%)]" data-testid="metho-store-page">
      <header className="sticky top-0 z-20 border-b border-emerald-900/10 bg-white/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <Logo showTagline />
          <Link to="/"><Button variant="outline" className="rounded-full">Back to Landing</Button></Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-10 space-y-8">
        <section className="rounded-3xl border border-emerald-900/10 bg-white shadow-sm overflow-hidden">
          <div className="relative bg-gradient-to-br from-emerald-950 to-emerald-800 px-6 py-10 text-white">
            {settings?.directory_hero_image_url_full && (
              <div className="absolute inset-0 opacity-25 bg-cover bg-center" style={{ backgroundImage: `url(${settings.directory_hero_image_url_full})` }} />
            )}
            <div className="relative">
              <p className="text-xs uppercase tracking-[0.25em] text-amber-300 font-semibold">Directory</p>
              <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h1 className="font-display font-black text-3xl md:text-5xl tracking-tight">View Metho Store</h1>
                  <p className="mt-3 max-w-2xl text-sm md:text-base text-emerald-100/85 font-body">
                    Search by shop name or city. Open WhatsApp, view the address, and jump straight to Google Maps from one place.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_180px_auto] lg:min-w-[34rem]">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" className="h-11 pl-9 bg-white text-slate-900" data-testid="metho-store-search" />
                  </div>
                  <select value={city} onChange={(e) => setCity(e.target.value)} className="h-11 rounded-md border border-input px-3 bg-white text-slate-900" data-testid="metho-store-city">
                    <option value="">All cities</option>
                    {cities.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <Button type="button" variant="outline" className="h-11 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20" onClick={resetFilters} data-testid="metho-store-view-all">
                    View All
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600 font-body">
              {loading ? "Loading stores..." : <>Showing <span className="font-semibold text-emerald-900">{partners.length}</span> result{partners.length === 1 ? "" : "s"}{city ? <> in <span className="font-semibold text-emerald-900">{city}</span></> : null}</>}
            </p>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-border bg-white p-12 text-center text-slate-500">Loading Metho Store listings...</div>
          ) : partners.length === 0 ? (
            <div className="rounded-2xl border border-border bg-white p-12 text-center">
              <p className="font-semibold text-emerald-950">No stores found</p>
              <p className="mt-2 text-sm text-slate-500">Try another shop name or city, or use View All.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {partners.map((partner) => <StoreCard key={partner.id || partner.partner_code || partner.owner_code} partner={partner} />)}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function StoreCard({ partner }) {
  const address = [partner.address, partner.city, partner.state, partner.pincode].filter(Boolean).join(", ");
  const whatsapp = waUrl(partner);
  const bannerSrc = partner.banner_url || partner.logo_url;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm" data-testid={`metho-store-card-${partner.partner_code || partner.id}`}>
      <div className="h-44 bg-slate-100 overflow-hidden">
        {bannerSrc ? (
          <img src={bannerSrc} alt={partner.business_name || "Store banner"} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center bg-emerald-50 text-emerald-800">
            <Building2 className="w-10 h-10" />
          </div>
        )}
      </div>
      <div className="p-5 space-y-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">{partner.city || "Metho Store"}</p>
          <h2 className="mt-1 font-display font-black text-xl text-emerald-950">{partner.store_name || partner.business_name || partner.owner_code || "METHO Store"}</h2>
          {partner.business_name && partner.store_name ? <p className="text-sm text-slate-500 mt-1">{partner.business_name}</p> : partner.contact_person ? <p className="text-sm text-slate-500 mt-1">{partner.contact_person}</p> : null}
        </div>

        <div className="space-y-3 text-sm text-slate-600 font-body">
          {address ? (
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 mt-0.5 text-emerald-700 shrink-0" />
              <span>{address}</span>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {whatsapp ? (
            <a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-green-700" data-testid={`metho-store-whatsapp-${partner.partner_code || partner.id}`}>
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </a>
          ) : (
            <div className="rounded-xl border border-dashed border-border px-3 py-2.5 text-center text-xs text-slate-400">WhatsApp not set</div>
          )}
          <a href={mapsUrl(partner)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 px-3 py-2.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-50" data-testid={`metho-store-map-${partner.partner_code || partner.id}`}>
            <Navigation className="w-4 h-4" /> Google Map
          </a>
        </div>
      </div>
    </div>
  );
}
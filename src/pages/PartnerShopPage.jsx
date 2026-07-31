import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Building2, MapPin, Phone, ArrowLeft, Store, ShoppingCart, Plus, Minus, Navigation, Share2, LogIn, MessageCircle, Gift, Star, Images, Search, FileText, CalendarCheck2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import UpiPaymentDialog from "@/components/UpiPaymentDialog";
import { resolveAssetUrl } from "@/lib/utils";

const mapsUrl = (p) => {
  const q = [p.business_name, p.address, p.city, p.state].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};
const PDF_PREVIEW = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23f1f5f9'/><rect x='80' y='50' width='240' height='300' rx='14' fill='%23ffffff' stroke='%2394a3b8' stroke-width='4'/><text x='200' y='190' text-anchor='middle' fill='%23dc2626' font-size='46' font-family='Arial' font-weight='bold'>PDF</text><text x='200' y='228' text-anchor='middle' fill='%23334155' font-size='16' font-family='Arial'>Tap to Open</text></svg>";
const cleanPhone = (v) => (v || "").replace(/[^\d]/g, "");
const waUrl = (p) => {
  const n = cleanPhone(p.whatsapp_no || p.phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(`Hi ${p.business_name}, I found your shop on METHOO STORE`)}` : null;
};

const getPdfUrl = (product) => {
  if (!product) return "";
  if (product.pdf_url) return resolveAssetUrl(product.pdf_url);
  if (product.product_pdf_url) return resolveAssetUrl(product.product_pdf_url);
  if (Array.isArray(product.pdf_urls) && product.pdf_urls[0]) return resolveAssetUrl(product.pdf_urls[0]);
  if (Array.isArray(product.pdfs) && product.pdfs[0]) {
    const first = product.pdfs[0];
    if (typeof first === "string") return resolveAssetUrl(first);
    if (first.url) return resolveAssetUrl(first.url);
    if (first.pdf_url) return resolveAssetUrl(first.pdf_url);
  }
  return "";
};

const isLikelyAssetRef = (value) => {
  const s = String(value || "").trim();
  if (!s) return false;
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:") || s.startsWith("blob:")) return true;
  if (s.startsWith("/")) return true;
  return /(media\/|uploads\/|static\/|\.(png|jpe?g|webp|gif|svg|pdf)(\?|$))/i.test(s);
};

const firstValidAssetRef = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && isLikelyAssetRef(value)) return resolveAssetUrl(value);
  }
  return "";
};

const isPdfUrl = (value) => /\.pdf($|\?)/i.test(String(value || ""));

const getProductImageUrl = (product) => {
  const url = firstValidAssetRef(
    product?.image_url,
    product?.product_image_url,
    product?.image,
    product?.thumbnail_url,
    product?.thumb_url,
    product?.cover_url,
    product?.photo_url
  );
  return isPdfUrl(url) ? "" : url;
};

const getDisplayImage = (product, placeholder) => {
  const image = getProductImageUrl(product);
  if (!image && product?.fallback_image_url) return resolveAssetUrl(product.fallback_image_url);
  if (image) return image;
  return placeholder || "";
};

const applyImageFallback = (event, fallbackUrl, finalFallback = "") => {
  const target = event.currentTarget;
  const next = String(fallbackUrl || "").trim();
  const last = String(finalFallback || "").trim();
  const alreadyRetried = target.dataset.retryFallback === "1";

  if (!alreadyRetried && next && target.src !== next) {
    target.dataset.retryFallback = "1";
    target.src = next;
    return;
  }
  if (last && target.src !== last) {
    target.src = last;
  }
};

const pickImageUrl = (value) => {
  if (!value) return "";
  if (typeof value === "string") return isLikelyAssetRef(value) ? resolveAssetUrl(value) : "";
  if (typeof value === "object") {
    return firstValidAssetRef(
      value.url,
      value.image_url,
      value.featured_image_url,
      value.path,
      value.file_url,
      value.public_url,
      value.secure_url,
      value.src,
      value.image,
      value.link
    );
  }
  return "";
};

const normalizeFeaturedImages = (raw) => {
  const source = raw?.items ?? raw?.featured_images ?? raw;
  if (Array.isArray(source)) return source.map((u) => pickImageUrl(u)).filter(Boolean).slice(0, 5);
  if (source && typeof source === "object") {
    const ordered = [1, 2, 3, 4, 5].map((slot) => (
      source[String(slot)] ||
      source[slot] ||
      source[`featured_${slot}`] ||
      source[`featured_${slot}_url`] ||
      source[`image_${slot}`] ||
      source[`slot_${slot}`] ||
      source[`slot_${slot}_url`] ||
      ""
    ));
    const direct = ordered.map((u) => pickImageUrl(u)).filter(Boolean);
    if (direct.length) return direct.slice(0, 5);
    return Object.values(source)
      .map((u) => pickImageUrl(u))
      .filter(Boolean)
      .slice(0, 5);
  }
  return [];
};

const isServiceListing = (item) => {
  if (!item) return false;
  const hint = [item?.listing_type, item?.item_kind, item?.kind, item?.type, item?.product_kind]
    .find((v) => typeof v === "string" && v.trim());
  if (String(hint || "").toLowerCase().includes("service")) return true;
  if (item?.is_service === true || item?.service_booking_enabled === true) return true;
  return false;
};

const normalizePartnerPayload = (payload) => {
  const partner = payload?.partner || {};
  const featuredImages = normalizeFeaturedImages(payload?.featured_images || payload?.partner?.featured_images);
  const bannerFallback = firstValidAssetRef(partner?.banner_url, partner?.shop_banner_url, partner?.banner, partner?.cover_url);
  const logoFallback = firstValidAssetRef(partner?.logo_url, partner?.logo, partner?.shop_logo_url);
  const fallbackPool = [...featuredImages, bannerFallback, logoFallback].filter(Boolean);
  const products = Array.isArray(payload?.products)
    ? payload.products.map((item, index) => {
      const resolvedImage = getProductImageUrl(item);
      const fallbackImage = fallbackPool[index % Math.max(1, fallbackPool.length)] || "";
      return {
        ...item,
        image_url: resolvedImage || "",
        fallback_image_url: fallbackImage,
        pdf_url: getPdfUrl(item),
      };
    })
    : [];
  return {
    ...payload,
    partner: {
      ...partner,
      logo_url: firstValidAssetRef(partner?.logo_url, partner?.logo, partner?.shop_logo_url),
      banner_url: firstValidAssetRef(partner?.banner_url, partner?.shop_banner_url, partner?.banner, partner?.cover_url) || firstValidAssetRef(partner?.logo_url, partner?.logo, partner?.shop_logo_url),
    },
    products,
    featured_images: featuredImages,
  };
};

export default function PartnerShopPage() {
  const { partnerCode } = useParams();
  const { user } = useAuth();
  const { settings } = useSettings();
  const placeholder = settings?.product_placeholder_image_url_full;
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [paymentProfile, setPaymentProfile] = useState(null);
  const [err, setErr] = useState(null);
  const [cart, setCart] = useState({});
  const [open, setOpen] = useState(false);
  const [guestMemberRef, setGuestMemberRef] = useState("");
  const [cashback, setCashback] = useState(null); // {percent, max, eligible}
  const [productSearch, setProductSearch] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");

  useEffect(() => {
    api.get(`/directory/partner/${partnerCode}`)
      .then(r => setData(normalizePartnerPayload(r.data)))
      .catch(e => setErr(e?.response?.data?.detail || "Shop not found"));
  }, [partnerCode]);

  useEffect(() => {
    api.get(`/partner/public-payment-profile/${partnerCode}`)
      .then((r) => setPaymentProfile(r.data))
      .catch(() => setPaymentProfile(null));
  }, [partnerCode]);

  // Load cashback offer (public setting) + user's eligibility (only if logged in as member)
  useEffect(() => {
    api.get("/settings").then(r => {
      const pct = Number(r.data?.first_partner_order_cashback_percent) || 0;
      const max = Number(r.data?.first_partner_order_cashback_max) || 0;
      if (pct > 0) setCashback(c => ({ ...(c || {}), percent: pct, max }));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user || user.role !== "member") return;
    api.get("/auth/me").then(r => {
      setCashback(c => ({ ...(c || {}), eligible: !r.data?.first_partner_cashback_credited }));
    }).catch(() => {});
  }, [user]);

  const p = data?.partner;
  const products = useMemo(() => data?.products || [], [data?.products]);
  const productListings = useMemo(() => products.filter((item) => !isServiceListing(item)), [products]);
  const serviceListings = useMemo(() => products.filter((item) => isServiceListing(item)), [products]);
  const featuredImages = useMemo(() => normalizeFeaturedImages(data?.featured_images), [data?.featured_images]);
  const bestFiveProducts = useMemo(() => productListings.slice(0, 5), [productListings]);
  const getStock = (product) => Math.max(0, Number(product?.stock ?? 0));
  const isBookNowRole = !user || ["member", "customer"].includes(String(user?.role || "").toLowerCase());
  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return productListings;
    return productListings.filter((p) => {
      const haystack = [p?.name, p?.category, p?.description]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [productListings, productSearch]);
  const displayedProducts = useMemo(() => filteredProducts.slice(0, 5), [filteredProducts]);
  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return serviceListings;
    return serviceListings.filter((p) => {
      const haystack = [data?.partner?.business_name, p?.name, p?.category, p?.description]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [data?.partner?.business_name, serviceListings, serviceSearch]);

  const inc = (id) => {
    const product = products.find((x) => String(x.id) === String(id));
    const stock = getStock(product);
    if (stock <= 0) {
      toast.error(`${product?.name || "Product"}: out of stock`);
      return;
    }
    const current = Number(cart[id] || 0);
    if (current >= stock) {
      toast.error(`${product?.name || "Product"}: max available stock is ${stock}`);
      return;
    }
    setCart({ ...cart, [id]: current + 1 });
  };
  const dec = (id) => setCart({ ...cart, [id]: Math.max(0, (cart[id] || 0) - 1) });

  const items = useMemo(() =>
    Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => {
        const pr = products.find(x => String(x.id) === String(id));
        const subtotal = Number(((pr?.price || 0) * q).toFixed(2));
        return {
          ...pr,
          quantity: q,
          subtotal,
          pdf_url: getPdfUrl(pr),
          listing_type: isServiceListing(pr) ? "service" : "product",
          item_kind: isServiceListing(pr) ? "service" : "product",
          is_service: isServiceListing(pr),
        };
      }),
    [cart, products]
  );
  const total = items.reduce((s, i) => s + i.subtotal, 0);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: p.business_name, url });
      else { await navigator.clipboard.writeText(url); toast.success("Shop link copied"); }
    } catch { /* user cancelled */ }
  };

  const openGallery = (searchValue = "", tab = "products") => {
    const next = searchValue.trim();
    const params = new URLSearchParams();
    if (next) params.set("q", next);
    params.set("tab", tab);
    nav(`/gallery/${partnerCode}${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const bookServiceNow = (service) => {
    if (!service?.id) return;
    setCart((prev) => ({ ...prev, [service.id]: 1 }));
    setOpen(true);
    toast.success(`${service.name || "Service"} booking started`);
  };

  if (err) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
      <p className="text-red-700 font-semibold">{err}</p>
      <Link to="/directory" className="mt-4 text-emerald-800 hover:underline text-sm">← Back to directory</Link>
    </div>
  );
  if (!data) return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading shop...</div>;

  const addr = [p.address, p.city, p.state, p.pincode].filter(Boolean).join(", ");
  const heroBannerSrc = p?.banner_url || featuredImages[0] || getProductImageUrl(bestFiveProducts[0]) || p?.logo_url || "";

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-8" data-testid="partner-shop-page">
      <header className="bg-emerald-950 text-white sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/directory" className="flex items-center gap-2 text-sm hover:text-amber-400" data-testid="back-to-directory">
            <ArrowLeft className="w-4 h-4" /> Directory
          </Link>
          <Logo />
        </div>
      </header>

      {/* SHOP HERO */}
      <div className="bg-gradient-to-br from-emerald-900 to-emerald-950 text-white relative overflow-hidden">
        {heroBannerSrc ? (
          <div className="absolute inset-0 opacity-25">
            <img
              src={heroBannerSrc}
              alt="Shop banner"
              className="w-full h-full object-cover"
              onError={(e) => {
                applyImageFallback(e, featuredImages[0] || getProductImageUrl(bestFiveProducts[0]) || p.logo_url || "", placeholder || "");
              }}
            />
            <div className="absolute inset-0 bg-emerald-950/55" />
          </div>
        ) : null}
        <div className="max-w-6xl mx-auto px-4 py-8 md:py-10 relative">
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-amber-400 text-emerald-950 flex items-center justify-center shrink-0 overflow-hidden">
              {p.logo_url ? <img src={p.logo_url} alt="" className="w-full h-full object-cover" /> : <Building2 className="w-10 h-10" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-[0.3em] text-amber-400 font-bold flex items-center gap-2">
                {p.partner_code} · Verified Partner
                {p.is_featured && (
                  <span className="inline-flex items-center gap-1 bg-amber-400 text-emerald-950 px-2 py-0.5 rounded-full text-[9px]">
                    <Star className="w-2.5 h-2.5 fill-emerald-950" /> Featured
                  </span>
                )}
              </p>
              <h1 className="font-display font-black text-2xl md:text-4xl mt-1" data-testid="shop-title">{p.business_name}</h1>
              <p className="text-emerald-100/80 mt-1 text-sm capitalize">{p.business_type}{p.contact_person ? ` · ${p.contact_person}` : ""}</p>
              {addr && (
                <p className="mt-3 flex items-start gap-1.5 text-xs text-emerald-100/90 max-w-2xl">
                  <MapPin className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <span data-testid="shop-address">{addr}</span>
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {p.phone && (
              <a
                href={`tel:${p.phone}`}
                className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-xs font-semibold px-4 py-2 transition"
                data-testid="shop-call"
              >
                <Phone className="w-3.5 h-3.5" /> {p.phone}
              </a>
            )}
            {waUrl(p) && (
              <a
                href={waUrl(p)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white border border-green-400 rounded-full text-xs font-bold px-4 py-2 transition"
                data-testid="shop-whatsapp"
              >
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
              </a>
            )}
            <a
              href={mapsUrl(p)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-xs font-semibold px-4 py-2 transition"
              data-testid="shop-address-chip"
            >
              <MapPin className="w-3.5 h-3.5" /> Address
            </a>
            <a
              href={mapsUrl(p)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-xs font-semibold px-4 py-2 transition"
              data-testid="shop-directions"
            >
              <Navigation className="w-3.5 h-3.5" /> Get Directions
            </a>
            <button
              onClick={share}
              className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-xs font-semibold px-4 py-2 transition"
              data-testid="shop-share"
            >
              <Share2 className="w-3.5 h-3.5" /> Share
            </button>
          </div>
        </div>
      </div>

      {!user && (
        <div className="max-w-6xl mx-auto px-4 pt-6">
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-wrap items-center gap-3" data-testid="guest-cta">
            <LogIn className="w-5 h-5 text-amber-700 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-emerald-950 text-sm">Guest checkout is available</p>
              <p className="text-xs text-slate-700 mt-0.5">Buy without login. Add Member ID/Code at checkout only if you want reward percentage attribution.</p>
            </div>
            <Link to={`/login?next=/partner-shop/${partnerCode}`}>
              <Button size="sm" className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full">Sign In (Optional)</Button>
            </Link>
            <Link to="/register">
              <Button size="sm" variant="outline" className="rounded-full border-emerald-900 text-emerald-900 hover:bg-emerald-50">Join Free</Button>
            </Link>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-8">
        {(featuredImages.length > 0 || bestFiveProducts.length > 0) && (
          <div className="mb-8 bg-white rounded-xl border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Images className="w-5 h-5 text-emerald-700" />
              <h2 className="font-display font-bold text-2xl text-emerald-950">Best 5 Products</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {[0, 1, 2, 3, 4].map((slot) => {
                const fallbackProduct = bestFiveProducts[slot];
                const imageSrc = featuredImages[slot] || featuredImages[0] || getProductImageUrl(fallbackProduct) || heroBannerSrc || "";
                return (
                <div key={`best-product-${slot}`} className="aspect-square rounded-lg overflow-hidden border border-border bg-slate-100 relative">
                  {imageSrc ? (
                    <img
                      src={imageSrc}
                      alt={fallbackProduct?.name || `Featured ${slot + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        applyImageFallback(
                          e,
                          featuredImages[slot] || featuredImages[0] || getProductImageUrl(fallbackProduct) || heroBannerSrc || "",
                          ""
                        );
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs font-semibold">
                      Upload Image
                    </div>
                  )}
                  {fallbackProduct?.name ? (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-2">
                      <p className="text-white text-[11px] font-semibold truncate">{fallbackProduct.name}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr] mb-8">
          <div className="bg-white rounded-xl border border-border p-6" data-testid="partner-shop-left-gallery-panel">
            <div className="flex items-start gap-2 mb-1">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">All Product View</p>
            </div>
            <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">View All Products</h3>
            <p className="text-sm text-slate-600 mt-3">See product details, PDF view, and add-to-cart flow in one place.</p>
            <div className="mt-6">
              <Button onClick={() => openGallery("", "products")} className="w-full bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="partner-gallery-btn">
                <Images className="w-4 h-4 mr-2" /> View All Products
              </Button>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border p-6" data-testid="partner-shop-right-search-panel">
            <div className="flex items-start gap-2 mb-1">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Search & Filter</p>
            </div>
            <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">Product Name / Category</h3>
            <p className="text-sm text-slate-600 mt-3">Filter the gallery by product name or category.</p>
            <div className="mt-6 flex gap-2">
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                placeholder="e.g. malt, face care"
                className="h-11 rounded-full text-sm"
                data-testid="partner-shop-product-search"
              />
              <Button
                onClick={() => openGallery(productSearch, "products")}
                className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full shrink-0"
                data-testid="partner-shop-product-search-btn"
              >
                Search
              </Button>
            </div>
          </div>
        </div>

        <section className="bg-white rounded-xl border border-border p-6" data-testid="partner-shop-all-products-box">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">All Product View</p>
              <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">Products ({displayedProducts.length})</h3>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="flex items-center gap-2 border border-border rounded-full px-3 h-11 bg-slate-50 w-full md:w-72">
                <Search className="w-4 h-4 text-slate-500" />
                <input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search by product name/category"
                  className="bg-transparent outline-none text-sm w-full"
                  data-testid="partner-shop-inline-search"
                />
              </div>
              <Button variant="outline" className="rounded-full" onClick={() => openGallery(productSearch, "products")} data-testid="partner-shop-view-all-link">
                View All
              </Button>
            </div>
          </div>

          {displayedProducts.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center text-slate-500">
              No product found for this search.
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {displayedProducts.map((product) => {
                const qty = cart[product.id] || 0;
                const outOfStock = getStock(product) <= 0;
                const pdfUrl = getPdfUrl(product);
                return (
                  <div key={product.id} className="border border-border rounded-xl overflow-hidden bg-white" data-testid={`shop-product-${product.id}`}>
                    <div className="aspect-square bg-slate-100 relative">
                      <img
                        src={getDisplayImage(product, placeholder)}
                        alt={product.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          applyImageFallback(
                            e,
                            getProductImageUrl(product) || product?.fallback_image_url || featuredImages[0] || heroBannerSrc || "",
                            placeholder || ""
                          );
                        }}
                      />
                      {pdfUrl ? (
                        <button
                          type="button"
                          onClick={() => window.open(pdfUrl, "_blank")}
                          className="absolute top-2 left-2 rounded-full bg-white/90 text-emerald-900 text-[10px] font-bold px-2.5 py-1"
                          data-testid={`shop-open-pdf-${product.id}`}
                        >
                          <FileText className="w-3 h-3 inline mr-1" /> PDF
                        </button>
                      ) : null}
                    </div>
                    <div className="p-3">
                      <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold truncate">{product.category}</p>
                      <p className="font-display font-bold text-emerald-950 mt-0.5 line-clamp-1">{product.name}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-display font-black text-emerald-950">₹{product.price}</span>
                        <span className="text-[11px] text-slate-500">Stock: {getStock(product)}</span>
                      </div>

                      {outOfStock ? (
                        <Button disabled className="w-full mt-3 rounded-full">Out of Stock</Button>
                      ) : qty > 0 ? (
                        <div className="mt-3 flex items-center justify-between bg-emerald-50 rounded-full px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => dec(product.id)}
                            className="w-8 h-8 rounded-full bg-white flex items-center justify-center"
                            data-testid={`shop-dec-${product.id}`}
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="font-bold text-emerald-950">{qty}</span>
                          <button
                            type="button"
                            onClick={() => inc(product.id)}
                            className="w-8 h-8 rounded-full bg-white flex items-center justify-center"
                            data-testid={`shop-inc-${product.id}`}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          onClick={() => inc(product.id)}
                          className="w-full mt-3 rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
                          data-testid={`shop-add-${product.id}`}
                        >
                          <ShoppingCart className="w-4 h-4 mr-2" /> Add to Cart
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Cashback banner */}
        {cashback?.percent > 0 && (user?.role !== "member" || cashback.eligible) && (
          <div className="mb-8 rounded-xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-yellow-50 p-5 flex flex-wrap items-center gap-3" data-testid="cashback-banner">
            <div className="w-10 h-10 rounded-full bg-amber-400 text-emerald-950 flex items-center justify-center shrink-0">
              <Gift className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display font-black text-emerald-950 text-sm md:text-base">
                {user?.role === "member" ? "First Partner-shop order?" : "New member offer"} Get {cashback.percent}% cashback
                {cashback.max > 0 ? <span className="text-amber-800"> (up to ₹{cashback.max})</span> : null}
              </p>
              <p className="text-xs text-slate-700 mt-0.5 font-body">
                Auto-credited to your Wallet once your first Partner order is approved. One-time offer per member.
              </p>
            </div>
            {!user && (
              <Link to={`/register`}>
                <Button size="sm" className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full">Join Free →</Button>
              </Link>
            )}
          </div>
        )}
      </main>

      {/* Sticky Cart Bar */}
      {items.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-emerald-950 text-white shadow-2xl border-t border-emerald-800" data-testid="sticky-cart-bar">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Cart</p>
              <p className="font-display font-bold text-lg leading-tight">{items.length} item{items.length !== 1 ? "s" : ""} · ₹{total.toLocaleString("en-IN")}</p>
              {!user && <p className="text-[11px] text-emerald-100/80">Guest checkout: reward percentage only if Member ID/Code is provided.</p>}
            </div>
            <Button
              onClick={() => setOpen(true)}
              className="bg-amber-400 hover:bg-amber-500 text-emerald-950 rounded-full font-bold h-11 px-6"
              data-testid="shop-checkout"
            >
              <ShoppingCart className="w-4 h-4 mr-2" /> Checkout
            </Button>
          </div>
        </div>
      )}

      <div className="mb-8">
        <div className="bg-white rounded-xl border border-border p-6" data-testid="partner-shop-left-services-panel">
          <div className="flex items-start gap-2 mb-1">
            <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">All Service View</p>
          </div>
          <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">View All Services</h3>
          <p className="text-sm text-slate-600 mt-3">Browse the partner services gallery, open service details, and start booking with Book Now.</p>
          <div className="mt-6 flex flex-col lg:flex-row gap-3 lg:items-center">
            <Button onClick={() => openGallery("", "services")} className="w-full lg:w-auto lg:min-w-[220px] bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="partner-services-gallery-btn">
              <CalendarCheck2 className="w-4 h-4 mr-2" /> View All Services
            </Button>
            <div className="flex flex-1 gap-2" data-testid="partner-shop-right-service-search-panel">
              <Input
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                placeholder="Search by business name, service, category"
                className="h-11 rounded-full text-sm"
                data-testid="partner-shop-service-search"
              />
              <Button
                onClick={() => openGallery(serviceSearch, "services")}
                className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full shrink-0"
                data-testid="partner-shop-service-search-btn"
              >
                Search
              </Button>
            </div>
          </div>
        </div>
      </div>

      <section className="bg-white rounded-xl border border-border p-6 mb-8" data-testid="partner-shop-all-services-box">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">All Service View</p>
            <h3 className="font-display font-bold text-emerald-950 text-lg mt-1">Services ({filteredServices.length})</h3>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <Button variant="outline" className="rounded-full shrink-0" onClick={() => openGallery(serviceSearch, "services")} data-testid="partner-shop-services-view-all-link">
              View All Services
            </Button>
            <div className="flex items-center gap-2 border border-border rounded-full px-3 h-11 bg-slate-50 w-full md:w-72">
              <Search className="w-4 h-4 text-slate-500" />
              <input
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                placeholder="Search by business name/service/category"
                className="bg-transparent outline-none text-sm w-full"
                data-testid="partner-shop-inline-service-search"
              />
            </div>
          </div>
        </div>

        {filteredServices.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center text-slate-500">
            No service found for this search.
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredServices.map((service) => {
              const pdfUrl = getPdfUrl(service);
              return (
                <div key={service.id} className="border border-border rounded-xl overflow-hidden bg-white" data-testid={`shop-service-${service.id}`}>
                  <div className="aspect-square bg-slate-100 relative">
                    <img
                      src={getDisplayImage(service, placeholder)}
                      alt={service.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        applyImageFallback(
                          e,
                            getProductImageUrl(service) || service?.fallback_image_url || featuredImages[0] || heroBannerSrc || "",
                            placeholder || ""
                        );
                      }}
                    />
                    {pdfUrl ? (
                      <button
                        type="button"
                        onClick={() => window.open(pdfUrl, "_blank")}
                        className="absolute top-2 left-2 rounded-full bg-white/90 text-emerald-900 text-[10px] font-bold px-2.5 py-1"
                        data-testid={`shop-open-service-pdf-${service.id}`}
                      >
                        <FileText className="w-3 h-3 inline mr-1" /> PDF
                      </button>
                    ) : null}
                  </div>
                  <div className="p-3">
                    <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold truncate">{service.category}</p>
                    <p className="font-display font-bold text-emerald-950 mt-0.5 line-clamp-1">{service.name}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-display font-black text-emerald-950">₹{service.price}</span>
                      <span className="text-[11px] text-slate-500">Service</span>
                    </div>

                    <Button
                      type="button"
                      onClick={() => bookServiceNow(service)}
                      className="w-full mt-3 rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
                      data-testid={`shop-book-service-${service.id}`}
                    >
                      <CalendarCheck2 className="w-4 h-4 mr-2" /> Book Now
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <UpiPaymentDialog
        open={open}
        onOpenChange={setOpen}
        items={items}
        total={total}
        paymentConfig={paymentProfile ? {
          upi_id: paymentProfile.upi_id,
          payee_name: paymentProfile.payee_name,
          qr_url: paymentProfile.qr_url,
          manual_upi_enabled: paymentProfile.manual_upi_enabled,
          razorpay_enabled: false,
          label: "Partner UPI Payment",
        } : null}
        isGuest={!user}
        memberRef={guestMemberRef}
        onMemberRefChange={setGuestMemberRef}
        onOrderPlaced={() => {
          setCart({});
          setGuestMemberRef("");
          setOpen(false);
          toast.success("Order placed successfully");
          if (user) setTimeout(() => nav("/app/orders"), 400);
        }}
      />
    </div>
  );
}


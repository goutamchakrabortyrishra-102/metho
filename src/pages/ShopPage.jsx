import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, MapPinned, Minus, Plus, ShoppingCart, Images, Search, X } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import UpiPaymentDialog from "@/components/UpiPaymentDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { getGstInclusivePrice, resolveAssetUrl, getAssetImageFallbackCandidates } from "@/lib/utils";

const normalizeYoutubeUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(www\.)?youtube\.com\//i.test(raw) || /^youtu\.be\//i.test(raw)) return `https://${raw}`;
  if (/youtube\.com|youtu\.be/i.test(raw)) return `https://${raw}`;
  if (/^[A-Za-z0-9_-]{11}$/i.test(raw)) return `https://www.youtube.com/watch?v=${raw}`;
  return "";
};

const getProductVideoUrl = (product) => normalizeYoutubeUrl(
  product?.youtube_url ||
  product?.youtubeUrl ||
  product?.video_url ||
  product?.videoUrl ||
  product?.meta?.youtube_url ||
  product?.product_meta?.youtube_url ||
  product?.payload?.youtube_url ||
  ""
);

const FALLBACK_IMAGE = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'><rect width='600' height='600' fill='%23e2e8f0'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23475569' font-size='28' font-family='Arial, sans-serif'>METHO Product</text></svg>";

const normalizeCollection = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  return [];
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

const getDisplayImage = (product, placeholderImage = "") => {
  const imageUrl = resolveAssetUrl(
    product?.image_url ||
    product?.product_image_url ||
    product?.image ||
    product?.thumbnail_url ||
    product?.thumb_url ||
    ""
  );
  if (imageUrl) return imageUrl;
  return placeholderImage || FALLBACK_IMAGE;
};

const applyOrderedImageFallback = (event, candidates, terminalFallback) => {
  const target = event.currentTarget;
  const tried = Number(target.dataset.fallbackIndex || "0");
  const list = Array.isArray(candidates) ? candidates : [];
  for (let i = tried; i < list.length; i += 1) {
    const next = String(list[i] || "").trim();
    if (!next || next === target.src) continue;
    target.dataset.fallbackIndex = String(i + 1);
    target.src = next;
    return;
  }
  if (target.src !== terminalFallback) target.src = terminalFallback;
};

const normalizePricingTiers = (tiers) => {
  if (!Array.isArray(tiers)) return [];
  const map = {};
  for (const row of tiers) {
    const qty = Number(row?.qty ?? row?.quantity ?? 0);
    const price = Number(row?.price ?? 0);
    if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price <= 0) continue;
    map[Math.trunc(qty)] = Number(price.toFixed(2));
  }
  return Object.keys(map)
    .map((qty) => ({ qty: Number(qty), price: map[qty] }))
    .sort((a, b) => a.qty - b.qty);
};

const calcTieredSubtotal = (quantity, unitPrice, tiers) => {
  const qty = Math.max(1, Number(quantity || 1));
  const normalized = normalizePricingTiers(tiers);
  const options = [...normalized];
  if (!options.some((o) => o.qty === 1)) {
    options.push({ qty: 1, price: Number(unitPrice || 0) });
  }
  options.sort((a, b) => a.qty - b.qty);

  const dp = Array(qty + 1).fill(Number.POSITIVE_INFINITY);
  dp[0] = 0;
  for (let q = 1; q <= qty; q += 1) {
    for (const opt of options) {
      if (opt.qty <= q) {
        dp[q] = Math.min(dp[q], dp[q - opt.qty] + opt.price);
      }
    }
  }
  if (!Number.isFinite(dp[qty])) return Number((qty * Number(unitPrice || 0)).toFixed(2));
  return Number(dp[qty].toFixed(2));
};

const getCustomerUnitPrice = (product) => {
  const productType = String(product?.product_type || "metho").toLowerCase();
  const gstPercent = ["metho", "metho_service"].includes(productType) ? Number(product?.gst_percent || 0) : 0;
  return getGstInclusivePrice(product?.price, gstPercent);
};

const getCustomerPricingTiers = (product) => {
  const tiers = Array.isArray(product?.pricing_tiers) ? product.pricing_tiers : [];
  if (!["metho", "metho_service"].includes(String(product?.product_type || "metho").toLowerCase())) return tiers;
  const gstPercent = Number(product?.gst_percent || 0);
  return tiers.map((tier) => ({
    ...tier,
    price: getGstInclusivePrice(tier?.price, gstPercent),
  }));
};

const loadShopStartupProducts = async (limit = 240) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 240, 500));
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
  throw lastError || new Error("shop products fetch failed");
};

const LANDING_CART_STORAGE_KEY = "metho_shared_cart_v1";

export default function ShopPage() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const placeholder = settings?.product_placeholder_image_url_full || "";
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [loadError, setLoadError] = useState("");
  const [cart, setCart] = useState({});
  const [previewProduct, setPreviewProduct] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [guestMemberRef, setGuestMemberRef] = useState("");
  const isGalleryView = searchParams.get("view") === "gallery";
  const autoPdfTriggered = useRef(false);
  const sharedCartHydratedRef = useRef(false);
  const allowPdfDownload = ["partner", "admin", "super_admin", "company_admin"].includes(String(user?.role || "").toLowerCase());

  const getStock = (product) => Math.max(0, Number(product?.stock ?? 0));

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      api.post("/seed").catch(() => {});
    }
    loadShopStartupProducts(240)
      .then((rows) => {
        setProducts(rows);
        setLoadError("");
      })
      .catch(() => {
        setProducts([]);
        setLoadError("Products could not be loaded right now. Please try again in a moment.");
      });
  }, []);

  useEffect(() => {
    setQuery(searchParams.get("q") || "");
  }, [searchParams]);

  const inc = (product) => {
    const stock = getStock(product);
    const isTourismService = String(product?.product_type || "").toLowerCase() === "metho_service" && Boolean(product?.is_service);
    if (!isTourismService && stock <= 0) {
      toast.error(`${product?.name || "Product"}: out of stock`);
      return;
    }

    setCart((c) => {
      const current = c[product.id] || 0;
      if (!isTourismService && current >= stock) {
        toast.error(`${product?.name || "Product"}: max available stock is ${stock}`);
        return c;
      }
      return { ...c, [product.id]: current + 1 };
    });
  };

  const dec = (id) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] || 0) - 1) }));

  // Pull in items added via the landing page's product cards, then clear the shared key.
  useEffect(() => {
    if (!products.length || sharedCartHydratedRef.current) return;
    sharedCartHydratedRef.current = true;
    try {
      const raw = localStorage.getItem(LANDING_CART_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") {
        setCart((prev) => {
          const next = { ...prev };
          Object.entries(parsed).forEach(([id, qty]) => {
            const product = products.find((p) => p.id === id);
            if (!product) return;
            const stock = getStock(product);
            const wanted = Math.max(0, Number(qty) || 0);
            const merged = (next[id] || 0) + wanted;
            next[id] = stock > 0 ? Math.min(merged, stock) : merged;
          });
          return next;
        });
      }
      localStorage.removeItem(LANDING_CART_STORAGE_KEY);
    } catch {}
  }, [products]);

  useEffect(() => {
    if (!products.length) return;
    setCart((prev) => {
      const next = {};
      Object.entries(prev).forEach(([id, qty]) => {
        const p = products.find((x) => x.id === id);
        const stock = getStock(p);
        const normalizedQty = Math.min(Math.max(0, Number(qty) || 0), stock);
        if (normalizedQty > 0) next[id] = normalizedQty;
      });
      return next;
    });
  }, [products]);

  const methoProducts = useMemo(() => {
    return (products || []).filter((p) => {
      const typeOk = ["metho", "metho_service"].includes(String(p?.product_type || "metho").toLowerCase());
      const hiddenRaw = p?.hidden;
      const isHidden = hiddenRaw === true || String(hiddenRaw).toLowerCase() === "true" || String(hiddenRaw) === "1";
      return typeOk && !isHidden;
    });
  }, [products]);

  const visibleProducts = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return methoProducts;
    return methoProducts.filter((p) => {
      const text = [p?.name, p?.category, p?.description]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return text.includes(q);
    });
  }, [methoProducts, query]);

  const items = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => {
          const p = methoProducts.find((x) => x.id === id);
          if (!p) return null;
          const customerPrice = getCustomerUnitPrice(p);
          const subtotal = calcTieredSubtotal(qty, customerPrice, getCustomerPricingTiers(p));
          const deliveryCharge = Math.max(0, Number(p?.delivery_charge || 0));
          return {
            id,
            name: p?.name,
            price: customerPrice,
            quantity: qty,
            subtotal,
            delivery_charge: deliveryCharge,
            free_delivery_threshold: Math.max(0, Number(p?.free_delivery_threshold || 0)),
            image_url: p?.image_url || "",
            pdf_url: getPdfUrl(p),
            category: p?.category || "",
            product_type: p?.product_type || "metho",
            is_service: Boolean(p?.is_service),
            listing_type: p?.is_service ? "service" : "product",
            item_kind: p?.is_service ? "service" : "product",
            service_booking_enabled: Boolean(p?.service_booking_enabled),
            service_template_key: p?.service_template_key || "",
            booking_available_from: p?.booking_available_from || "",
            booking_available_until: p?.booking_available_until || "",
          };
        })
        .filter(Boolean)
        .filter((x) => x.price > 0),
    [cart, methoProducts]
  );

  const merchandiseSubtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
  const deliveryGroups = items.reduce((groups, item) => {
    const key = String(item.category || "General").trim().toLowerCase();
    const group = groups[key] || { subtotal: 0, charge: 0, threshold: 0 };
    group.subtotal += item.subtotal;
    group.charge = Math.max(group.charge, Number(item.delivery_charge || 0));
    group.threshold = Math.max(group.threshold, Number(item.free_delivery_threshold || 0));
    groups[key] = group;
    return groups;
  }, {});
  const deliveryByCategory = Object.fromEntries(Object.entries(deliveryGroups).map(([key, group]) => [key, group.threshold > 0 && group.subtotal >= group.threshold ? 0 : group.charge]));
  const cartDeliveryTotal = Math.max(0, ...Object.values(deliveryByCategory));
  const checkoutItems = items.map((item, index) => ({ ...item, delivery_total: index === 0 ? cartDeliveryTotal : 0 }));
  const total = merchandiseSubtotal + cartDeliveryTotal;

  const downloadCatalogPdf = useCallback(async () => {
    if (!visibleProducts.length) {
      toast.error("No products available for PDF");
      return;
    }
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();

      doc.setFillColor(5, 46, 22);
      doc.rect(0, 0, W, 24, "F");
      doc.setTextColor(251, 191, 36);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("METHO Product Catalog", 10, 11);
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(new Date().toLocaleDateString("en-IN"), W - 10, 11, { align: "right" });
      doc.setTextColor(21, 128, 61);
      doc.textWithLink("Open Shop & Add to Cart", W - 10, 18, { url: `${window.location.origin}/shop` });

      let y = 30;
      visibleProducts.forEach((p, idx) => {
        if (y > 282) {
          doc.addPage();
          y = 12;
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(10, y + 2, W - 10, y + 2);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(5, 46, 22);
        doc.text(`${idx + 1}. ${p.name || "Product"}`, 10, y + 8);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text(`${p.category || "General"} | Stock: ${p.stock ?? 0}`, 10, y + 13);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(5, 46, 22);
        doc.text(`INR ${getCustomerUnitPrice(p).toLocaleString("en-IN")}`, W - 10, y + 8, { align: "right" });
        y += 16;
      });

      const totalPages = doc.internal.getNumberOfPages();
      for (let pg = 1; pg <= totalPages; pg++) {
        doc.setPage(pg);
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.text(`METHO Catalog · Page ${pg}/${totalPages}`, W / 2, 292, { align: "center" });
      }

      doc.save("METHO_Product_Catalog.pdf");
      toast.success("PDF downloaded");
    } catch {
      toast.error("PDF could not be generated right now");
    }
  }, [visibleProducts]);

  useEffect(() => {
    if (!allowPdfDownload) return;
    if (searchParams.get("autoPdf") !== "1") return;
    if (searchParams.get("view") === "gallery") return;
    const next = new URLSearchParams(searchParams);
    next.set("view", "gallery");
    setSearchParams(next, { replace: true });
  }, [allowPdfDownload, searchParams, setSearchParams]);

  useEffect(() => {
    if (!allowPdfDownload) return;
    if (searchParams.get("autoPdf") !== "1") return;
    if (!isGalleryView) return;
    if (!visibleProducts.length) return;
    if (autoPdfTriggered.current) return;
    autoPdfTriggered.current = true;
    downloadCatalogPdf();
  }, [allowPdfDownload, searchParams, isGalleryView, visibleProducts, downloadCatalogPdf]);

  const runSearch = () => {
    const next = new URLSearchParams(searchParams);
    const cleaned = String(query || "").trim();
    if (cleaned) next.set("q", cleaned);
    else next.delete("q");
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="min-h-screen bg-background" data-testid="shop-page">
      <header className="glass border-b border-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <Logo showTagline />
          <Link to="/"><Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900"><ArrowLeft className="w-4 h-4 mr-2" /> Home</Button></Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-12">
        <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">Shop</p>
        <h1 className="mt-2 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950">Shop &amp; Travel</h1>
        <p className="text-slate-600 font-body mt-2 max-w-2xl">
          Shop METHO essentials and reserve curated travel services in one secure checkout.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50"
            onClick={() => setSearchParams(isGalleryView ? {} : { view: "gallery" })}
            data-testid="shop-toggle-gallery-view"
          >
            <Images className="w-4 h-4 mr-2" /> {isGalleryView ? "Back to Shop View" : "View Gallery"}
          </Button>
          {allowPdfDownload ? (
            <Button
              variant="outline"
              className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50"
              onClick={downloadCatalogPdf}
              data-testid="shop-download-pdf"
            >
              Download PDF Catalog
            </Button>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="shop-search-wrap">
          <div className="relative w-full sm:w-[360px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch();
                }
              }}
              placeholder="Search products, stays, and travel services"
              className="h-11 pl-9 rounded-full"
              data-testid="shop-search-input"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={runSearch}
            className="h-11 rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50"
            data-testid="shop-search-button"
          >
            Search
          </Button>
        </div>
        {!user && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900" data-testid="guest-mode-badge">
            Guest Mode Active · Continue as Guest Checkout
          </div>
        )}

        {loadError ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="shop-load-error">
            {loadError}
          </div>
        ) : null}

        <div className={`mt-10 grid gap-4 ${isGalleryView ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}`}>
          {visibleProducts.map((p, i) => {
            const stock = getStock(p);
            const isTourismService = String(p?.product_type || "").toLowerCase() === "metho_service" && Boolean(p?.is_service);
            const isOutOfStock = !isTourismService && stock <= 0;
            const rawImageRef =
              p?.image_url ||
              p?.product_image_url ||
              p?.image ||
              p?.thumbnail_url ||
              p?.thumb_url ||
              "";
            const fallbackCandidates = getAssetImageFallbackCandidates(rawImageRef, [placeholder, FALLBACK_IMAGE]);
            return (
            <div key={p.id} className={`bg-white rounded-xl overflow-hidden border group hover:shadow-lg transition-all ${isTourismService ? "border-sky-200 shadow-sm" : "border-border"}`} data-testid={`shop-product-${i}`}>
              <div
                className="aspect-square overflow-hidden bg-secondary relative cursor-zoom-in"
                onClick={() => setPreviewProduct(p)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPreviewProduct(p);
                  }
                }}
                data-testid={`shop-open-image-${i}`}
                aria-label={`Open preview for ${p?.name || "product"}`}
              >
                <img
                  src={getDisplayImage(p, placeholder)}
                  alt={p.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  onError={(e) => {
                    applyOrderedImageFallback(e, fallbackCandidates, FALLBACK_IMAGE);
                  }}
                />
                <span className={
                  "absolute top-2 left-2 pointer-events-none text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full " +
                  (isTourismService ? "bg-sky-700 text-white" : "bg-amber-500 text-emerald-950")
                }>
                  {isTourismService ? "Travel" : "METHO"}
                </span>
              </div>
              <div className="p-4">
                <p className={`text-[10px] uppercase tracking-wider font-semibold ${isTourismService ? "text-sky-800" : "text-emerald-800"}`}>{p.category}</p>
                <h4 className="mt-1 font-display font-bold text-emerald-950 line-clamp-1">{p.name}</h4>
                {!isGalleryView && <p className="text-xs text-muted-foreground mt-1 line-clamp-3 font-body whitespace-pre-line">{p.description}</p>}
                {isTourismService ? <div className="mt-3 flex items-center gap-3 text-[11px] font-semibold text-sky-800"><span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> Request date &amp; time</span><span className="inline-flex items-center gap-1"><MapPinned className="w-3.5 h-3.5" /> Booking support</span></div> : null}
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-display font-black text-xl text-emerald-950">₹{getCustomerUnitPrice(p).toLocaleString("en-IN")}</span>
                  {Number(p?.gst_percent || 0) > 0 ? <span className="text-[10px] text-amber-700 font-semibold">GST {Number(p.gst_percent)}% Included</span> : null}
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isTourismService ? "bg-sky-100 text-sky-900" : "bg-amber-100 text-amber-900"}`}>{isTourismService ? "Bookable service" : "METHO"}</span>
                    {isOutOfStock ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-700">
                        Out of Stock
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3">
                  {(cart[p.id] || 0) > 0 ? (
                    <div className="flex items-center justify-between bg-emerald-50 rounded-full px-2 py-1" data-testid={`shop-qty-wrap-${i}`}>
                      <button
                        type="button"
                        onClick={() => dec(p.id)}
                        className="w-7 h-7 rounded-full bg-white hover:bg-emerald-100 flex items-center justify-center"
                        data-testid={`shop-dec-${i}`}
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="font-bold text-emerald-950 text-sm" data-testid={`shop-qty-${i}`}>{cart[p.id] || 0}</span>
                      <button
                        type="button"
                        onClick={() => inc(p)}
                        className="w-7 h-7 rounded-full bg-white hover:bg-emerald-100 flex items-center justify-center"
                        data-testid={`shop-inc-${i}`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full bg-emerald-900 hover:bg-emerald-950 rounded-full text-xs"
                      data-testid={`shop-buy-${i}`}
                      onClick={() => inc(p)}
                      disabled={isOutOfStock}
                    >
                      {isOutOfStock ? "Unavailable" : (isTourismService ? "Reserve Now" : "Add to Cart")}
                    </Button>
                  )}
                  {getProductVideoUrl(p) ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full mt-2 rounded-full text-xs"
                      onClick={() => window.open(getProductVideoUrl(p), "_blank", "noopener,noreferrer")}
                      data-testid={`shop-watch-video-${i}`}
                    >
                      Watch Video
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          );})}
        </div>
        <p className="mt-6 text-xs leading-5 text-slate-500">Travel services are subject to <Link to="/travel-booking-terms" className="font-semibold text-sky-800 underline">Travel Booking Terms</Link>. Supplier availability, itinerary, inclusions and final confirmation are provided for each booking.</p>
      </div>

      {previewProduct ? (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setPreviewProduct(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="aspect-square overflow-hidden bg-slate-100 relative">
              <img
                src={getDisplayImage(previewProduct, placeholder)}
                alt={previewProduct?.name || "Product image"}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const rawRef =
                    previewProduct?.image_url ||
                    previewProduct?.product_image_url ||
                    previewProduct?.image ||
                    previewProduct?.thumbnail_url ||
                    previewProduct?.thumb_url ||
                    "";
                  const candidates = getAssetImageFallbackCandidates(rawRef, [placeholder, FALLBACK_IMAGE]);
                  applyOrderedImageFallback(e, candidates, FALLBACK_IMAGE);
                }}
              />
              <button onClick={() => setPreviewProduct(null)} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">{previewProduct?.category || "General"}</p>
              <h3 className="font-display font-black text-emerald-950 text-xl mt-1">{previewProduct?.name || "Product"}</h3>
              {previewProduct?.description ? <p className="text-sm text-slate-600 mt-2 whitespace-pre-line">{previewProduct.description}</p> : <p className="text-sm text-slate-500 mt-2">No description provided.</p>}
              <div className="mt-3 flex items-center justify-between">
                <span className="font-display font-black text-3xl text-emerald-950">₹{getCustomerUnitPrice(previewProduct).toLocaleString("en-IN")}</span>
                {Math.max(0, Number(previewProduct?.stock ?? 0)) <= 0 ? <span className="text-sm text-slate-500">Out of Stock</span> : null}
              </div>
              {getProductVideoUrl(previewProduct) ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full mt-3 rounded-full"
                  onClick={() => window.open(getProductVideoUrl(previewProduct), "_blank", "noopener,noreferrer")}
                  data-testid="shop-preview-watch-video"
                >
                  Watch Video
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {items.length > 0 && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 w-[min(680px,calc(100vw-1.5rem))] bg-white border border-border rounded-2xl shadow-xl px-4 py-3" data-testid="shop-cart-bar">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-emerald-800 font-semibold flex items-center gap-1.5">
                <ShoppingCart className="w-3.5 h-3.5" /> Booking Cart
              </p>
              <p className="text-sm text-slate-700 mt-0.5">{items.length} item(s) selected</p>
              {!user && <p className="text-[11px] text-amber-800 mt-0.5">Continue as Guest Checkout</p>}
            </div>
            <Button
              onClick={() => setCheckoutOpen(true)}
              className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-5"
              data-testid="shop-checkout-button"
            >
              <ShoppingCart className="w-4 h-4 mr-2" />
              Checkout · ₹{total.toLocaleString("en-IN")}
            </Button>
          </div>
        </div>
      )}

      <UpiPaymentDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        items={checkoutItems}
        total={total}
        isGuest={!user}
        memberRef={guestMemberRef}
        onMemberRefChange={setGuestMemberRef}
        onItemQtyChange={(item, delta) => {
          const product = methoProducts.find((p) => p.id === item.id);
          if (!product) return;
          if (delta > 0) inc(product);
          else dec(item.id);
        }}
        onOrderPlaced={() => {
          setCheckoutOpen(false);
          setCart({});
          setGuestMemberRef("");
        }}
      />
    </div>
  );
}


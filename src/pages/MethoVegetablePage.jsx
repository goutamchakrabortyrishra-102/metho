import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Minus, Plus, ShoppingCart, Search, X } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import UpiPaymentDialog from "@/components/UpiPaymentDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { getGstInclusivePrice, resolveAssetUrl, getAssetImageFallbackCandidates } from "@/lib/utils";

const FALLBACK_IMAGE = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'><rect width='600' height='600' fill='%23ecfdf5'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23166534' font-size='26' font-family='Arial, sans-serif'>METHO Vegetable</text></svg>";

const VEGETABLE_PRODUCT_TYPE = "metho_vegetable";
// Separate cart key so this page never shares/mixes cart state with the METHO product shop.
const VEGETABLE_CART_STORAGE_KEY = "metho_vegetable_cart_v1";

const readStoredVegetableCart = () => {
  try {
    const raw = localStorage.getItem(VEGETABLE_CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeCollection = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  return [];
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

const getUnitType = (product) => {
  const unit = String(product?.unit_type || "piece").trim().toLowerCase();
  return ["kg", "gram", "piece"].includes(unit) ? unit : "piece";
};

const getQuantityStep = (product) => {
  const unit = getUnitType(product);
  return unit === "kg" ? 0.1 : unit === "gram" ? 100 : 1;
};

const getMeasureOptions = (product) => {
  const base = getUnitType(product);
  if (base === "kg") return ["kg", "gram"];
  if (base === "gram") return ["gram", "kg"];
  return ["piece"];
};

const measureStepInBaseUnit = (product, measureUnit) => {
  const base = getUnitType(product);
  if (base === "piece") return 1;
  if (base === "kg") return measureUnit === "kg" ? 1 : 0.1;
  return measureUnit === "kg" ? 1000 : 100;
};

const formatMeasureQuantity = (quantity, product, measureUnit) => {
  const base = getUnitType(product);
  const converted = base === "kg" && measureUnit === "gram" ? quantity * 1000
    : base === "gram" && measureUnit === "kg" ? quantity / 1000
      : quantity;
  const text = Number.isInteger(converted) ? String(converted) : String(Number(converted.toFixed(3)));
  return measureUnit === "piece" ? `${text} pc` : `${text} ${measureUnit}`;
};

const quantityChoices = (product, measureUnit) => {
  const stock = Math.max(0, Number(product?.stock || 0));
  const step = measureStepInBaseUnit(product, measureUnit);
  const count = Math.min(100, Math.floor((stock + 0.000001) / step));
  return Array.from({ length: count }, (_, index) => Number(((index + 1) * step).toFixed(3)));
};

const formatQuantity = (quantity, product) => {
  const value = Number(quantity || 0);
  const label = getUnitType(product);
  const text = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  return label === "piece" ? `${text} pc` : `${text} ${label}`;
};

const getCustomerUnitPrice = (product) => getGstInclusivePrice(product?.price, Number(product?.gst_percent || 0));

const getCustomerPricingTiers = (product) => {
  const tiers = Array.isArray(product?.pricing_tiers) ? product.pricing_tiers : [];
  const gstPercent = Number(product?.gst_percent || 0);
  return tiers.map((tier) => ({ ...tier, price: getGstInclusivePrice(tier?.price, gstPercent) }));
};

const loadVegetableStartupProducts = async (limit = 240) => {
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
  throw lastError || new Error("vegetable products fetch failed");
};

const readCart = () => {
  try {
    const raw = localStorage.getItem(VEGETABLE_CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeCart = (cart) => {
  try {
    localStorage.setItem(VEGETABLE_CART_STORAGE_KEY, JSON.stringify(cart || {}));
  } catch {
    // Ignore unavailable storage.
  }
};

export default function MethoVegetablePage() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const placeholder = settings?.product_placeholder_image_url_full || "";
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [loadError, setLoadError] = useState("");
  const [cart, setCart] = useState(readStoredVegetableCart);
  const [previewProduct, setPreviewProduct] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [guestMemberRef, setGuestMemberRef] = useState("");
  const [selectedUnits, setSelectedUnits] = useState({});

  const getStock = (product) => Math.max(0, Number(product?.stock ?? 0));

  useEffect(() => {
    loadVegetableStartupProducts(240)
      .then((rows) => {
        setProducts(rows);
        setLoadError("");
      })
      .catch(() => {
        setProducts([]);
        setLoadError("Vegetables could not be loaded right now. Please try again in a moment.");
      });
  }, []);

  useEffect(() => {
    setQuery(searchParams.get("q") || "");
  }, [searchParams]);

  useEffect(() => {
    writeCart(cart);
  }, [cart]);

  const vegetableProducts = useMemo(() => {
    return (products || []).filter((p) => {
      const typeOk = String(p?.product_type || "").toLowerCase() === VEGETABLE_PRODUCT_TYPE;
      const hiddenRaw = p?.hidden;
      const isHidden = hiddenRaw === true || String(hiddenRaw).toLowerCase() === "true" || String(hiddenRaw) === "1";
      return typeOk && !isHidden;
    });
  }, [products]);

  useEffect(() => {
    if (!products.length) return;
    setCart((prev) => {
      const next = {};
      Object.entries(prev).forEach(([id, qty]) => {
        const p = vegetableProducts.find((x) => x.id === id);
        const stock = getStock(p);
        const step = getQuantityStep(p);
        const normalizedQty = Math.min(Math.max(0, Math.round((Number(qty) || 0) / step) * step), stock);
        if (normalizedQty > 0) next[id] = normalizedQty;
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  const visibleProducts = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return vegetableProducts;
    return vegetableProducts.filter((p) => {
      const text = [p?.name, p?.category, p?.description].map((v) => String(v || "").toLowerCase()).join(" ");
      return text.includes(q);
    });
  }, [vegetableProducts, query]);

  const selectedUnitFor = (product) => selectedUnits[product.id] || getMeasureOptions(product)[0];

  const setQuantity = (product, quantity) => {
    const stock = getStock(product);
    const next = Math.min(stock, Math.max(0, Number(quantity || 0)));
    setCart((current) => ({ ...current, [product.id]: Number(next.toFixed(3)) }));
  };

  const inc = (product) => {
    const stock = getStock(product);
    if (stock <= 0) {
      toast.error(`${product?.name || "Item"}: out of stock`);
      return;
    }
    setCart((c) => {
      const step = measureStepInBaseUnit(product, selectedUnitFor(product));
      const current = Number(c[product.id] || 0);
      if (current + step > stock + 0.0001) {
        toast.error(`${product?.name || "Item"}: max available stock is ${stock}`);
        return c;
      }
      return { ...c, [product.id]: Number((current + step).toFixed(3)) };
    });
  };

  const dec = (product) => setCart((c) => ({ ...c, [product.id]: Math.max(0, Number((Number(c[product.id] || 0) - measureStepInBaseUnit(product, selectedUnitFor(product))).toFixed(3))) }));

  const items = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => {
          const p = vegetableProducts.find((x) => x.id === id);
          if (!p) return null;
          const customerPrice = getCustomerUnitPrice(p);
          const weighted = getUnitType(p) !== "piece";
          const subtotal = weighted
            ? Number((Number(qty) * customerPrice).toFixed(2))
            : calcTieredSubtotal(qty, customerPrice, getCustomerPricingTiers(p));
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
            category: p?.category || "",
            product_type: VEGETABLE_PRODUCT_TYPE,
            unit_type: getUnitType(p),
            unit_label: getUnitType(p),
            quantity_step: getQuantityStep(p),
            is_service: false,
            listing_type: "product",
            item_kind: "product",
          };
        })
        .filter(Boolean)
        .filter((x) => x.price > 0),
    [cart, vegetableProducts]
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

  const runSearch = () => {
    const next = new URLSearchParams(searchParams);
    const cleaned = String(query || "").trim();
    if (cleaned) next.set("q", cleaned);
    else next.delete("q");
    setSearchParams(next, { replace: true });
  };

  // Vegetable checkout only supports Razorpay (online) and Cash on Delivery — no manual UPI proof flow.
  const vegetablePaymentConfig = {
    vegetable_checkout: true,
    cod_enabled: true,
    manual_upi_enabled: false,
    razorpay_enabled: true,
    label: "METHO Vegetable Payment",
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 to-background" data-testid="metho-vegetable-page">
      <header className="glass border-b border-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <Logo showTagline />
          <Link to="/"><Button variant="ghost" className="hover:bg-emerald-50 hover:text-emerald-900"><ArrowLeft className="w-4 h-4 mr-2" /> Home</Button></Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-12">
        <p className="text-xs uppercase tracking-[0.25em] text-emerald-800 font-semibold">METHO Vegetable</p>
        <h1 className="mt-2 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950">Fresh Vegetables</h1>
        <p className="text-slate-600 font-body mt-2 max-w-2xl">
          Daily fresh vegetables, sourced and delivered by METHO. Pay online via Razorpay or choose Cash on Delivery.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2" data-testid="vegetable-search-wrap">
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
              placeholder="Search vegetables"
              className="h-11 pl-9 rounded-full"
              data-testid="vegetable-search-input"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={runSearch}
            className="h-11 rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50"
            data-testid="vegetable-search-button"
          >
            Search
          </Button>
        </div>
        {!user && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900" data-testid="vegetable-guest-mode-badge">
            Guest Mode Active · Continue as Guest Checkout
          </div>
        )}

        {loadError ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="vegetable-load-error">
            {loadError}
          </div>
        ) : null}

        <div className="mt-10 grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {visibleProducts.map((p, i) => {
            const stock = getStock(p);
            const isOutOfStock = stock <= 0;
            const rawImageRef = p?.image_url || p?.product_image_url || p?.image || p?.thumbnail_url || p?.thumb_url || "";
            const fallbackCandidates = getAssetImageFallbackCandidates(rawImageRef, [placeholder, FALLBACK_IMAGE]);
            return (
              <div key={p.id} className="bg-white rounded-xl overflow-hidden border border-emerald-900/10 group hover:shadow-lg transition-all" data-testid={`vegetable-product-${i}`}>
                <div
                  className="aspect-square overflow-hidden bg-emerald-50 relative cursor-zoom-in"
                  onClick={() => setPreviewProduct(p)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPreviewProduct(p);
                    }
                  }}
                  data-testid={`vegetable-open-image-${i}`}
                  aria-label={`Open preview for ${p?.name || "vegetable"}`}
                >
                  <img
                    src={getDisplayImage(p, placeholder)}
                    alt={p.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => { applyOrderedImageFallback(e, fallbackCandidates, FALLBACK_IMAGE); }}
                  />
                  <span className="absolute top-2 left-2 pointer-events-none text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-emerald-600 text-white">
                    Vegetable
                  </span>
                </div>
                <div className="p-4">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-emerald-800">{p.category}</p>
                  <h4 className="mt-1 font-display font-bold text-emerald-950 line-clamp-1">{p.name}</h4>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 font-body whitespace-pre-line">{p.description}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-display font-black text-xl text-emerald-950">₹{getCustomerUnitPrice(p).toLocaleString("en-IN")}{getUnitType(p) === "piece" ? "" : `/${getUnitType(p)}`}</span>
                    {isOutOfStock ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-700">Out of Stock</span>
                    ) : null}
                  </div>
                  <div className="mt-3">
                    {(() => {
                      const selectedUnit = selectedUnitFor(p);
                      const choices = quantityChoices(p, selectedUnit);
                      const isWeighted = getUnitType(p) !== "piece";
                      return <div className="space-y-2">
                        <div className={isWeighted ? "grid grid-cols-2 gap-2" : "grid grid-cols-1"}>
                          {isWeighted ? <select value={selectedUnit} onChange={(event) => { const unit = event.target.value; setSelectedUnits((current) => ({ ...current, [p.id]: unit })); if (cart[p.id] > 0) setQuantity(p, quantityChoices(p, unit)[0] || 0); }} className="h-9 rounded-md border border-emerald-200 bg-white px-2 text-xs font-semibold text-emerald-950" data-testid={`vegetable-unit-${i}`}>
                            {getMeasureOptions(p).map((unit) => <option key={unit} value={unit}>{unit.toUpperCase()}</option>)}
                          </select> : null}
                          <select value={String(cart[p.id] || choices[0] || "")} onChange={(event) => setQuantity(p, Number(event.target.value))} disabled={!choices.length} className="h-9 rounded-md border border-emerald-200 bg-white px-2 text-xs font-semibold text-emerald-950" data-testid={`vegetable-quantity-${i}`}>
                            {choices.map((quantity) => <option key={quantity} value={quantity}>{formatMeasureQuantity(quantity, p, selectedUnit)}</option>)}
                          </select>
                        </div>
                        {(cart[p.id] || 0) > 0 ? (
                      <div className="flex items-center justify-between bg-emerald-50 rounded-full px-2 py-1" data-testid={`vegetable-qty-wrap-${i}`}>
                        <button type="button" onClick={() => dec(p)} className="w-7 h-7 rounded-full bg-white hover:bg-emerald-100 flex items-center justify-center" data-testid={`vegetable-dec-${i}`}>
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="font-bold text-emerald-950 text-sm" data-testid={`vegetable-qty-${i}`}>{formatQuantity(cart[p.id], p)}</span>
                        <button type="button" onClick={() => inc(p)} className="w-7 h-7 rounded-full bg-white hover:bg-emerald-100 flex items-center justify-center" data-testid={`vegetable-inc-${i}`}>
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        className="w-full bg-emerald-900 hover:bg-emerald-950 rounded-full text-xs"
                        data-testid={`vegetable-buy-${i}`}
                        onClick={() => inc(p)}
                        disabled={isOutOfStock}
                      >
                        {isOutOfStock ? "Unavailable" : "Add to Cart"}
                      </Button>
                    )}</div>;
                    })()}
                  </div>
                </div>
              </div>
            );
          })}
          {visibleProducts.length === 0 && !loadError ? (
            <div className="col-span-full rounded-2xl border border-emerald-900/10 bg-white/90 p-8 text-center">
              <p className="font-display font-bold text-emerald-950">Vegetables are being added</p>
              <p className="mt-1 text-sm text-slate-600">Please check back soon.</p>
            </div>
          ) : null}
        </div>
      </div>

      {previewProduct ? (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setPreviewProduct(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="aspect-square overflow-hidden bg-emerald-50 relative">
              <img
                src={getDisplayImage(previewProduct, placeholder)}
                alt={previewProduct?.name || "Vegetable image"}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const rawRef = previewProduct?.image_url || previewProduct?.product_image_url || previewProduct?.image || previewProduct?.thumbnail_url || previewProduct?.thumb_url || "";
                  const candidates = getAssetImageFallbackCandidates(rawRef, [placeholder, FALLBACK_IMAGE]);
                  applyOrderedImageFallback(e, candidates, FALLBACK_IMAGE);
                }}
              />
              <button onClick={() => setPreviewProduct(null)} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">{previewProduct?.category || "Vegetable"}</p>
              <h3 className="font-display font-black text-emerald-950 text-xl mt-1">{previewProduct?.name || "Vegetable"}</h3>
              {previewProduct?.description ? <p className="text-sm text-slate-600 mt-2 whitespace-pre-line">{previewProduct.description}</p> : <p className="text-sm text-slate-500 mt-2">No description provided.</p>}
              <div className="mt-3 flex items-center justify-between">
                <span className="font-display font-black text-3xl text-emerald-950">₹{getCustomerUnitPrice(previewProduct).toLocaleString("en-IN")}{getUnitType(previewProduct) === "piece" ? "" : `/${getUnitType(previewProduct)}`}</span>
                {Math.max(0, Number(previewProduct?.stock ?? 0)) <= 0 ? <span className="text-sm text-slate-500">Out of Stock</span> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {items.length > 0 && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 w-[min(680px,calc(100vw-1.5rem))] bg-white border border-border rounded-2xl shadow-xl px-4 py-3" data-testid="vegetable-cart-bar">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-emerald-800 font-semibold flex items-center gap-1.5">
                <ShoppingCart className="w-3.5 h-3.5" /> Vegetable Cart
              </p>
              <p className="text-sm text-slate-700 mt-0.5">{items.length} item(s) selected</p>
              {!user && <p className="text-[11px] text-amber-800 mt-0.5">Continue as Guest Checkout</p>}
            </div>
            <Button
              onClick={() => setCheckoutOpen(true)}
              className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-5"
              data-testid="vegetable-checkout-button"
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
        total={merchandiseSubtotal}
        isGuest={!user}
        memberRef={guestMemberRef}
        onMemberRefChange={setGuestMemberRef}
        paymentConfig={vegetablePaymentConfig}
        onItemQtyChange={(item, delta) => {
          const product = vegetableProducts.find((p) => p.id === item.id);
          if (!product) return;
          if (delta > 0) inc(product);
          else dec(product);
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

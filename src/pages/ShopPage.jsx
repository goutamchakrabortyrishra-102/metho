import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Minus, Plus, ShoppingCart, Images, Search } from "lucide-react";
import { jsPDF } from "jspdf";
import { toast } from "sonner";
import api from "@/services/api";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import UpiPaymentDialog from "@/components/UpiPaymentDialog";
import { useAuth } from "@/contexts/AuthContext";

const FALLBACK_IMAGE = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'><rect width='600' height='600' fill='%23e2e8f0'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23475569' font-size='28' font-family='Arial, sans-serif'>METHOO STORE Product</text></svg>";
const PDF_PREVIEW = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'><rect width='600' height='600' fill='%23f1f5f9'/><rect x='130' y='90' width='340' height='420' rx='18' fill='%23ffffff' stroke='%2394a3b8' stroke-width='6'/><text x='300' y='290' text-anchor='middle' fill='%23dc2626' font-size='68' font-family='Arial' font-weight='bold'>PDF</text><text x='300' y='340' text-anchor='middle' fill='%23334155' font-size='20' font-family='Arial'>Catalog Link</text></svg>";

const getPdfUrl = (product) => {
  if (!product) return "";
  if (product.pdf_url) return product.pdf_url;
  if (product.product_pdf_url) return product.product_pdf_url;
  if (Array.isArray(product.pdf_urls) && product.pdf_urls[0]) return product.pdf_urls[0];
  if (Array.isArray(product.pdfs) && product.pdfs[0]) {
    const first = product.pdfs[0];
    if (typeof first === "string") return first;
    if (first.url) return first.url;
    if (first.pdf_url) return first.pdf_url;
  }
  return "";
};

const getDisplayImage = (product) => {
  if (product?.image_url) return product.image_url;
  return getPdfUrl(product) ? PDF_PREVIEW : FALLBACK_IMAGE;
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

export default function ShopPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [loadError, setLoadError] = useState("");
  const [cart, setCart] = useState({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [guestMemberRef, setGuestMemberRef] = useState("");
  const isGalleryView = searchParams.get("view") === "gallery";
  const autoPdfTriggered = useRef(false);
  const allowPdfDownload = user?.role === "partner";

  const getStock = (product) => Math.max(0, Number(product?.stock ?? 0));

  useEffect(() => {
    api.post("/seed").catch(() => {});
    api
      .get("/products")
      .then((r) => {
        setProducts(Array.isArray(r.data) ? r.data : []);
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
    if (stock <= 0) {
      toast.error(`${product?.name || "Product"}: out of stock`);
      return;
    }

    setCart((c) => {
      const current = c[product.id] || 0;
      if (current >= stock) {
        toast.error(`${product?.name || "Product"}: max available stock is ${stock}`);
        return c;
      }
      return { ...c, [product.id]: current + 1 };
    });
  };

  const dec = (id) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] || 0) - 1) }));

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
    return (products || []).filter((p) => String(p?.product_type || "metho").toLowerCase() === "metho" && !p.hidden);
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
          const subtotal = p?.product_type === "metho"
            ? calcTieredSubtotal(qty, p?.price || 0, p?.pricing_tiers || [])
            : Number(((Number(p?.price) || 0) * qty).toFixed(2));
          return {
            id,
            name: p?.name,
            price: Number(p?.price) || 0,
            quantity: qty,
            subtotal,
            image_url: p?.image_url || "",
            pdf_url: getPdfUrl(p),
            category: p?.category || "",
          };
        })
        .filter(Boolean)
        .filter((x) => x.price > 0),
    [cart, methoProducts]
  );

  const total = items.reduce((sum, i) => sum + i.subtotal, 0);

  const downloadCatalogPdf = useCallback(() => {
    if (!visibleProducts.length) {
      toast.error("No products available for PDF");
      return;
    }
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();

    doc.setFillColor(5, 46, 22);
    doc.rect(0, 0, W, 24, "F");
    doc.setTextColor(251, 191, 36);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("METHOO STORE Product Catalog", 10, 11);
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
      doc.text(`INR ${Number(p.price || 0).toLocaleString("en-IN")}`, W - 10, y + 8, { align: "right" });
      y += 16;
    });

    const totalPages = doc.internal.getNumberOfPages();
    for (let pg = 1; pg <= totalPages; pg++) {
      doc.setPage(pg);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`METHOO STORE Catalog · Page ${pg}/${totalPages}`, W / 2, 292, { align: "center" });
    }

    doc.save("METHO_Product_Catalog.pdf");
    toast.success("PDF downloaded");
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
        <h1 className="mt-2 font-display font-black text-4xl md:text-5xl tracking-tight text-emerald-950">All Products</h1>
        <p className="text-slate-600 font-body mt-2 max-w-2xl">
          Buy directly as guest or sign in as member. If you are buying as guest, you can optionally add a Member ID/Code during checkout for reward attribution.
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
              placeholder="Search METHO products by name/category"
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
            const isOutOfStock = stock <= 0;
            return (
            <div key={p.id} className="bg-white rounded-xl overflow-hidden border border-border group hover:shadow-lg transition-all" data-testid={`shop-product-${i}`}>
              <div className="aspect-square overflow-hidden bg-secondary relative">
                <img
                  src={getDisplayImage(p)}
                  alt={p.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  onError={(e) => {
                    if (e.currentTarget.src !== FALLBACK_IMAGE) e.currentTarget.src = FALLBACK_IMAGE;
                  }}
                />
                <span className={
                  "absolute top-2 left-2 text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full " +
                  "bg-amber-500 text-emerald-950"
                }>
                  METHO
                </span>
              </div>
              <div className="p-4">
                <p className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold">{p.category}</p>
                <h4 className="mt-1 font-display font-bold text-emerald-950 line-clamp-1">{p.name}</h4>
                {!isGalleryView && <p className="text-xs text-muted-foreground mt-1 line-clamp-3 font-body whitespace-pre-line">{p.description}</p>}
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-display font-black text-xl text-emerald-950">₹{p.price}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-900">METHO</span>
                    <span className={
                      "text-[10px] px-2 py-0.5 rounded-full font-semibold " +
                      (isOutOfStock ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-800")
                    }>
                      {isOutOfStock ? "Out" : `Stock ${stock}`}
                    </span>
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
                      {isOutOfStock ? "Out of Stock" : "Add to Cart"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );})}
        </div>
      </div>

      {items.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(680px,calc(100vw-1.5rem))] bg-white border border-border rounded-2xl shadow-xl px-4 py-3" data-testid="shop-cart-bar">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-emerald-800 font-semibold flex items-center gap-1.5">
                <ShoppingCart className="w-3.5 h-3.5" /> Cart
              </p>
              <p className="text-sm text-slate-700 mt-0.5">{items.length} item(s) selected</p>
              {!user && <p className="text-[11px] text-amber-800 mt-0.5">Continue as Guest Checkout</p>}
            </div>
            <Button
              onClick={() => setCheckoutOpen(true)}
              className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-5"
              data-testid="shop-checkout-button"
            >
              Checkout · ₹{total.toLocaleString("en-IN")}
            </Button>
          </div>
        </div>
      )}

      <UpiPaymentDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        items={items}
        total={total}
        isGuest={!user}
        memberRef={guestMemberRef}
        onMemberRefChange={setGuestMemberRef}
        onOrderPlaced={() => {
          setCheckoutOpen(false);
          setCart({});
          setGuestMemberRef("");
        }}
      />
    </div>
  );
}


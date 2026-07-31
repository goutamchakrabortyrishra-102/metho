import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, ShoppingCart, Plus, Minus, Share2, FileDown,
  MessageCircle, X, Phone, MapPin, Store, Star, Search, CalendarCheck2,
} from "lucide-react";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import UpiPaymentDialog from "@/components/UpiPaymentDialog";
import { useAuth } from "@/contexts/AuthContext";
import { resolveAssetUrl } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const FALLBACK = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23e2e8f0'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23475569' font-size='20' font-family='Arial'>No Image</text></svg>";
const PDF_PREVIEW = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23f1f5f9'/><rect x='80' y='50' width='240' height='300' rx='14' fill='%23ffffff' stroke='%2394a3b8' stroke-width='4'/><text x='200' y='190' text-anchor='middle' fill='%23dc2626' font-size='46' font-family='Arial' font-weight='bold'>PDF</text><text x='200' y='228' text-anchor='middle' fill='%23334155' font-size='16' font-family='Arial'>Tap to Open</text></svg>";

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

const getDisplayImage = (product) => {
  if (product?.image_url) return resolveAssetUrl(product.image_url);
  return getPdfUrl(product) ? PDF_PREVIEW : FALLBACK;
};

const pickImageUrl = (value) => {
  if (!value) return "";
  if (typeof value === "string") return resolveAssetUrl(value);
  if (typeof value === "object") {
    return resolveAssetUrl(
      value.url ||
      value.image_url ||
      value.featured_image_url ||
      value.path ||
      ""
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

const normalizePartnerPayload = (payload) => {
  const partner = payload?.partner || {};
  const featuredImages = normalizeFeaturedImages(payload?.featured_images || payload?.partner?.featured_images);
  const products = Array.isArray(payload?.products)
    ? payload.products.map((item, index) => {
      const resolvedImage = resolveAssetUrl(item?.image_url || "");
      return {
        ...item,
        image_url: resolvedImage || featuredImages[index % Math.max(1, featuredImages.length)] || "",
        pdf_url: getPdfUrl(item),
      };
    })
    : [];
  return {
    ...payload,
    partner: {
      ...partner,
      logo_url: resolveAssetUrl(partner?.logo_url || ""),
      banner_url: resolveAssetUrl(partner?.banner_url || ""),
    },
    products,
    featured_images: { items: featuredImages },
  };
};

const isServiceListing = (item) => {
  if (!item) return false;
  const hint = [item?.listing_type, item?.item_kind, item?.kind, item?.type, item?.product_kind]
    .find((v) => typeof v === "string" && v.trim());
  if (String(hint || "").toLowerCase().includes("service")) return true;
  if (item?.is_service === true || item?.service_booking_enabled === true) return true;
  return false;
};

function ProductModal({ product, onClose, onAdd, onDec, qty, galleryUrl, isBookNowRole, onBookNow }) {
  if (!product) return null;
  const productUrl = `${galleryUrl}?p=${product.id}`;
  const pdfUrl = getPdfUrl(product);
  const isService = isServiceListing(product);
  // WhatsApp message: include image URL so WA shows image preview
  const mediaLine = product.image_url || pdfUrl;
  const waMsg = mediaLine
    ? `${mediaLine}\n\n🛍️ *${product.name}*\n💰 ₹${product.price}  |  ${product.category || ""}\n\n👉 এখানে দেখুন ও Order করুন:\n${productUrl}`
    : `🛍️ *${product.name}*\n💰 ₹${product.price}  |  ${product.category || ""}\n\n👉 এখানে দেখুন ও Order করুন:\n${productUrl}`;
  const canDownloadPdf = !!pdfUrl;
  const openPdfPreview = (url) => {
    if (!url) return;
    const withViewerFlags = `${url}${url.includes("#") ? "&" : "#"}toolbar=0&navpanes=0&scrollbar=1`;
    window.open(withViewerFlags, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="aspect-square overflow-hidden bg-slate-100 relative">
          <img
            src={getDisplayImage(product)}
            alt={product.name}
            className="w-full h-full object-cover"
            onError={e => { if (e.currentTarget.src !== FALLBACK) e.currentTarget.src = FALLBACK; }}
          />
          {canDownloadPdf && pdfUrl ? (
            <button
              type="button"
              onClick={() => openPdfPreview(pdfUrl)}
              className="absolute left-3 top-3 rounded-full bg-white/90 text-emerald-900 px-3 py-1 text-[10px] font-bold"
            >
              View PDF
            </button>
          ) : null}
          <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60">
            <X className="w-4 h-4" />
          </button>
          {product.stock <= 0 && !isService && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <span className="text-white font-black text-xl">Out of Stock</span>
            </div>
          )}
        </div>
        <div className="p-5">
          <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">{product.category}</p>
          <h3 className="font-display font-black text-emerald-950 text-xl mt-1">{product.name}</h3>
          {product.description && <p className="text-sm text-slate-600 mt-2 font-body">{product.description}</p>}
          <div className="mt-3 flex items-center justify-between">
            <span className="font-display font-black text-3xl text-emerald-950">₹{product.price}</span>
            <span className="text-sm text-slate-500">{isService ? "Service" : `Stock: ${product.stock ?? 0}`}</span>
          </div>
          <div className="mt-4 space-y-2">
            {product.stock <= 0 && !isService ? (
              <Button disabled className="w-full rounded-full">Unavailable</Button>
            ) : isService && isBookNowRole ? (
              <Button onClick={() => onBookNow(product)} className="w-full bg-emerald-900 hover:bg-emerald-950 text-white rounded-full text-base h-12">
                <CalendarCheck2 className="w-4 h-4 mr-2" /> Book Now
              </Button>
            ) : qty > 0 ? (
              <div className="flex items-center justify-between bg-emerald-50 rounded-full px-3 py-2">
                <button onClick={() => onDec(product.id)} className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:bg-emerald-100">
                  <Minus className="w-4 h-4" />
                </button>
                <span className="font-black text-emerald-950 text-lg">{qty}</span>
                <button onClick={() => onAdd(product.id)} className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:bg-emerald-100">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Button onClick={() => onAdd(product.id)} className="w-full bg-emerald-900 hover:bg-emerald-950 text-white rounded-full text-base h-12">
                {isService ? <CalendarCheck2 className="w-4 h-4 mr-2" /> : <ShoppingCart className="w-4 h-4 mr-2" />} {isService ? "Book Now" : "Add to Cart"}
              </Button>
            )}
            {/* Share this product on WhatsApp */}
            <button
              onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(waMsg)}`, '_blank')}
              className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white rounded-full py-2.5 text-sm font-bold"
            >
              <MessageCircle className="w-4 h-4" /> Share this product on WhatsApp
            </button>
            <button
              onClick={async () => { await navigator.clipboard.writeText(productUrl); }}
              className="w-full flex items-center justify-center gap-2 border border-slate-300 rounded-full py-2 text-xs text-slate-600 hover:bg-slate-50"
            >
              <Share2 className="w-3.5 h-3.5" /> Product Link Copy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PartnerGalleryPage() {
  const { partnerCode } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const autoPdfTriggered = useRef(false);
  const [data, setData] = useState(null);
  const [paymentProfile, setPaymentProfile] = useState(null);
  const [err, setErr] = useState(null);
  const [cart, setCart] = useState({});
  const [selected, setSelected] = useState(null); // product for modal
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [guestMemberRef, setGuestMemberRef] = useState("");
  const searchText = String(searchParams.get("q") || "").trim();
  const requestedTab = String(searchParams.get("tab") || "products").toLowerCase();
  const [gallerySearch, setGallerySearch] = useState(searchText);

  useEffect(() => {
    setGallerySearch(searchText);
  }, [searchText]);

  useEffect(() => {
    api.get(`/directory/partner/${partnerCode}`)
      .then(r => setData(normalizePartnerPayload(r.data)))
      .catch(e => setErr(e?.response?.data?.detail || "Gallery not found"));
  }, [partnerCode]);

  useEffect(() => {
    api.get(`/partner/public-payment-profile/${partnerCode}`)
      .then((r) => setPaymentProfile(r.data))
      .catch(() => setPaymentProfile(null));
  }, [partnerCode]);

  // Auto-open product from URL param ?p=productId
  useEffect(() => {
    const pid = searchParams.get("p");
    if (pid && data?.products) {
      const product = data.products.find((p) => String(p.id) === String(pid));
      if (product) setSelected(product);
    }
  }, [searchParams, data]);

  const partner = data?.partner;
  const products = useMemo(() => data?.products || [], [data?.products]);
  const productListings = useMemo(() => products.filter((item) => !isServiceListing(item)), [products]);
  const serviceListings = useMemo(() => products.filter((item) => isServiceListing(item)), [products]);
  const activeTab = requestedTab === "services" ? "services" : "products";
  const activeListings = activeTab === "services" ? serviceListings : productListings;
  const isBookNowRole = !user || ["member", "customer"].includes(String(user?.role || "").toLowerCase());
  const getStock = (product) => Math.max(0, Number(product?.stock ?? 0));
  const visibleProducts = useMemo(() => {
    const source = gallerySearch ? activeListings.filter((p) => {
      const q = gallerySearch.toLowerCase();
      const haystack = [p?.name, p?.category, p?.description]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    }) : activeListings;
    return source.slice(0, 5);
  }, [activeListings, gallerySearch]);
  const canDownloadPdf = user?.role === "partner";

  const addToCart = (id) => {
    const product = products.find((x) => String(x.id) === String(id));
    const isService = isServiceListing(product);
    if (isService) {
      setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
      return;
    }

    const stock = getStock(product);
    if (stock <= 0) {
      toast.error(`${product?.name || "Product"}: out of stock`);
      return;
    }

    setCart((c) => {
      const current = Number(c[id] || 0);
      if (current >= stock) {
        toast.error(`${product?.name || "Product"}: max available stock is ${stock}`);
        return c;
      }
      return { ...c, [id]: current + 1 };
    });
  };
  const decCart = (id) => setCart(c => ({ ...c, [id]: Math.max(0, (c[id] || 0) - 1) }));

  useEffect(() => {
    if (!products.length) return;
    setCart((prev) => {
      const next = {};
      Object.entries(prev).forEach(([id, qty]) => {
        const product = products.find((x) => String(x.id) === String(id));
        const isService = isServiceListing(product);
        if (isService) {
          const normalized = Math.max(0, Number(qty) || 0);
          if (normalized > 0) next[id] = normalized;
          return;
        }
        const stock = getStock(product);
        const normalized = Math.min(Math.max(0, Number(qty) || 0), stock);
        if (normalized > 0) next[id] = normalized;
      });
      return next;
    });
  }, [products]);

  const items = useMemo(() =>
    Object.entries(cart).filter(([, q]) => q > 0).map(([id, q]) => {
      const p = products.find((x) => String(x.id) === String(id));
      return {
        ...p,
        quantity: q,
        subtotal: (p?.price || 0) * q,
        image_url: p?.image_url || "",
        pdf_url: getPdfUrl(p),
        listing_type: isServiceListing(p) ? "service" : "product",
        item_kind: isServiceListing(p) ? "service" : "product",
        is_service: isServiceListing(p),
      };
    }),
    [cart, products]
  );
  const total = items.reduce((s, i) => s + i.subtotal, 0);

  const galleryUrl = `${window.location.origin}/gallery/${partnerCode}`;

  const handleBookNow = (listing) => {
    if (!listing?.id) return;
    setCart((prev) => ({ ...prev, [listing.id]: 1 }));
    setSelected(null);
    setCheckoutOpen(true);
    toast.success(`${listing.name || "Service"} booking started`);
  };

  const shareWhatsApp = () => {
    if (!partner) return;
    const productLines = visibleProducts.slice(0, 8).map(p =>
      `• ${p.name} — ₹${p.price}${(p.image_url || getPdfUrl(p)) ? `\n  ${p.image_url || getPdfUrl(p)}` : ""}`
    ).join("\n");
    const sectionLabel = activeTab === "services" ? "Service Gallery" : "Product Gallery";
    const msg = `🛍️ *${partner.business_name}* এর ${sectionLabel}\n\n${productLines}\n\n👉 সব দেখুন ও Order করুন:\n${galleryUrl}?tab=${activeTab}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(galleryUrl);
      toast.success("Gallery link copied!");
    } catch {
      toast.error("Copy failed");
    }
  };

  const downloadPDF = useCallback(async () => {
    if (!canDownloadPdf) {
      toast.error("PDF download is partner-only.");
      return;
    }
    if (!partner || visibleProducts.length === 0) { toast.error("No products to export"); return; }
    toast.info("Generating PDF, please wait...");

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(); // 210mm
    const COLS = 2;
    const CARD_W = (W - 18) / COLS; // ~96mm
    const IMG_H = 60;
    const CARD_H = IMG_H + 28;
    const MARGIN = 6;

    // Helper: load image URL → dataURL via canvas
    const loadImg = (url) => new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth || 400;
          c.height = img.naturalHeight || 400;
          c.getContext("2d").drawImage(img, 0, 0);
          resolve(c.toDataURL("image/jpeg", 0.75));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url + (url.includes("?") ? "&" : "?") + "_t=" + Date.now();
    });

    // Header
    doc.setFillColor(5, 46, 22);
    doc.rect(0, 0, W, 28, "F");
    doc.setTextColor(251, 191, 36);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(partner.business_name, 10, 12);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text(`${partner.business_type || ""} · ${partner.phone || ""} · ${partner.partner_code}`, 10, 20);
    doc.setTextColor(255, 255, 255);
    doc.text("METHOO STORE Product Catalog", W - 10, 10, { align: "right" });
    doc.text(new Date().toLocaleDateString("en-IN"), W - 10, 17, { align: "right" });
    doc.text(`methoaayupay.com/gallery/${partner.partner_code}`, W - 10, 24, { align: "right" });

    // Compact brand banner with direct shop link (opens cart-enabled gallery)
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(16, 185, 129);
    doc.roundedRect(8, 29, W - 16, 8, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(5, 46, 22);
    doc.text(`METHO + ${partner.business_name}`, 11, 34);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(21, 128, 61);
    doc.textWithLink("Open Partner Shop (Add to Cart)", W - 67, 34, { url: galleryUrl });

    let y = 40;

    for (let i = 0; i < visibleProducts.length; i++) {
      const col = i % COLS;
      const x = MARGIN + col * (CARD_W + 3);

      if (col === 0 && i > 0) y += CARD_H + 4;
      if (y + CARD_H > 285) { doc.addPage(); y = 10; }

      const p = visibleProducts[i];

      // Card background
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(220, 220, 220);
      doc.roundedRect(x, y, CARD_W, CARD_H, 2, 2, "FD");

      // Product image
      const imgData = await loadImg(p.image_url || "");
      if (imgData) {
        doc.addImage(imgData, "JPEG", x + 1, y + 1, CARD_W - 2, IMG_H - 1, "", "MEDIUM");
      } else {
        // Placeholder
        doc.setFillColor(226, 232, 240);
        doc.rect(x + 1, y + 1, CARD_W - 2, IMG_H - 1, "F");
        doc.setTextColor(148, 163, 184);
        doc.setFontSize(8);
        doc.text("No Image", x + CARD_W / 2, y + IMG_H / 2, { align: "center" });
      }

      // Product info below image
      const infoY = y + IMG_H + 4;
      doc.setTextColor(5, 46, 22);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      const name = (p.name || "").substring(0, 28);
      doc.text(name, x + 3, infoY);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(p.category || "", x + 3, infoY + 5);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(5, 46, 22);
      doc.text(`\u20B9${p.price}`, x + 3, infoY + 12);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(`Stock: ${p.stock ?? 0}`, x + CARD_W - 3, infoY + 12, { align: "right" });

      // Clickable product link: opens this product in gallery where cart flow lives.
      const productLink = `${galleryUrl}?p=${p.id}`;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(21, 128, 61);
      doc.textWithLink("View in Gallery / Add to Cart", x + 3, infoY + 18, { url: productLink });
    }

    // Footer
    const totalPages = doc.internal.getNumberOfPages();
    for (let pg = 1; pg <= totalPages; pg++) {
      doc.setPage(pg);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(21, 128, 61);
      doc.textWithLink(`Order online: methoaayupay.com/gallery/${partner.partner_code}`, W / 2, 288, { url: galleryUrl });
      doc.setFontSize(6);
      doc.setTextColor(148, 163, 184);
      doc.text(`Order করুন: methoaayupay.com/gallery/${partner.partner_code}  ·  Page ${pg}/${totalPages}`, W / 2, 292, { align: "center" });
    }

    doc.save(`${partner.partner_code}_Catalog.pdf`);
    toast.success("PDF downloaded!");
  }, [canDownloadPdf, galleryUrl, partner, visibleProducts]);

  // Auto-generate a combined PDF when opened from partner dashboard with ?autoPdf=1
  useEffect(() => {
    if (!canDownloadPdf) return;
    if (autoPdfTriggered.current) return;
    if (searchParams.get("autoPdf") !== "1") return;
    if (!partner || visibleProducts.length === 0) return;
    autoPdfTriggered.current = true;
    downloadPDF();
  }, [canDownloadPdf, downloadPDF, partner, visibleProducts, searchParams]);

  if (err) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
      <p className="text-red-700 font-semibold">{err}</p>
      <Link to="/directory" className="mt-4 text-emerald-800 hover:underline text-sm">← Back to directory</Link>
    </div>
  );
  if (!data) return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading gallery...</div>;

  return (
    <div className="min-h-screen bg-slate-50 pb-28" data-testid="partner-gallery-page">
      {/* Header */}
      <header className="bg-emerald-950 text-white sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to={`/partner-shop/${partnerCode}`} className="flex items-center gap-2 text-sm hover:text-amber-400">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
          <Logo />
          <div className="flex items-center gap-2">
            <button onClick={copyLink} className="p-2 rounded-full hover:bg-white/10" title="Copy Link">
              <Share2 className="w-4 h-4" />
            </button>
            {canDownloadPdf ? (
              <button onClick={downloadPDF} className="p-2 rounded-full hover:bg-white/10" title="Download PDF Catalog">
                <FileDown className="w-4 h-4" />
              </button>
            ) : null}
            <button onClick={shareWhatsApp} className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white rounded-full px-3 py-1.5 text-xs font-bold">
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp Share
            </button>
          </div>
        </div>
      </header>

      {/* Partner info strip */}
      <div className="bg-gradient-to-r from-emerald-900 to-emerald-800 text-white">
        <div className="max-w-4xl mx-auto px-4 py-5 flex flex-wrap items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-amber-400 text-emerald-950 flex items-center justify-center shrink-0 overflow-hidden">
            {partner.logo_url ? <img src={partner.logo_url} alt="" className="w-full h-full object-cover" /> : <Store className="w-7 h-7" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-amber-400 font-bold flex items-center gap-1.5">
              {partner.partner_code} · Verified
              {partner.is_featured && <Star className="w-3 h-3 fill-amber-400 text-amber-400" />}
            </p>
            <h1 className="font-display font-black text-xl text-white">{partner.business_name}</h1>
            <p className="text-emerald-100/70 text-xs mt-0.5">
              {[partner.city, partner.state].filter(Boolean).join(", ")}
              {partner.phone && <span> · <Phone className="w-3 h-3 inline" /> {partner.phone}</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-amber-400 uppercase font-bold">{activeTab === "services" ? "Services" : "Products"}</p>
            <p className="font-display font-black text-3xl">{activeListings.length}</p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 font-body">
          {activeTab === "services" ? "Tap the image to view details and book the service" : "Tap the image to view details and add it to the cart"}
        </p>
        <div className="flex gap-2">
          <Link to={`/gallery/${partnerCode}?tab=products${gallerySearch ? `&q=${encodeURIComponent(gallerySearch)}` : ""}`}>
            <Button variant={activeTab === "products" ? "default" : "outline"} size="sm" className={`rounded-full text-xs ${activeTab === "products" ? "bg-emerald-900 hover:bg-emerald-950 text-white" : "border-emerald-300 text-emerald-900 hover:bg-emerald-50"}`}>
              Products
            </Button>
          </Link>
          <Link to={`/gallery/${partnerCode}?tab=services${gallerySearch ? `&q=${encodeURIComponent(gallerySearch)}` : ""}`}>
            <Button variant={activeTab === "services" ? "default" : "outline"} size="sm" className={`rounded-full text-xs ${activeTab === "services" ? "bg-emerald-900 hover:bg-emerald-950 text-white" : "border-emerald-300 text-emerald-900 hover:bg-emerald-50"}`}>
              Services
            </Button>
          </Link>
          {canDownloadPdf ? (
            <Button variant="outline" size="sm" onClick={downloadPDF} className="rounded-full border-emerald-800 text-emerald-900 text-xs">
              Partner PDF Catalog
            </Button>
          ) : null}
          <Button size="sm" onClick={shareWhatsApp} className="rounded-full bg-green-600 hover:bg-green-700 text-white text-xs">
            <MessageCircle className="w-3.5 h-3.5 mr-1" /> Share on WhatsApp
          </Button>
        </div>
      </div>

      {!canDownloadPdf ? (
        <div className="max-w-4xl mx-auto px-4 pb-2">
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900" data-testid="gallery-pdf-role-note">
            Catalog PDF export and download are enabled only for Partner accounts. The Member/Customer cart flow remains unchanged.
          </div>
        </div>
      ) : null}

      <div className="max-w-4xl mx-auto px-4 pb-4">
        <div className="bg-white rounded-xl border border-border p-4 flex flex-col md:flex-row gap-2 md:items-center">
          <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm shrink-0">
            <Search className="w-4 h-4" /> {activeTab === "services" ? "Search Service" : "Search Product"}
          </div>
          <Input
            value={gallerySearch}
            onChange={(e) => setGallerySearch(e.target.value)}
            placeholder={activeTab === "services" ? "Search by service name or category" : "Search by product name or category"}
            className="rounded-full"
          />
          {gallerySearch ? (
            <Button
              type="button"
              variant="outline"
              className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50 shrink-0"
              onClick={() => setGallerySearch("")}
            >
              Clear Search
            </Button>
          ) : null}
        </div>
      </div>

      {/* Image Gallery Grid */}
      <main className="max-w-4xl mx-auto px-4">
        {visibleProducts.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-border">
            <Store className="w-10 h-10 text-slate-400 mx-auto" />
            <p className="mt-3 font-semibold text-emerald-950">
              {gallerySearch
                ? (activeTab === "services" ? "No matching services found" : "No matching products found")
                : (activeTab === "services" ? "No services yet" : "No products yet")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {visibleProducts.map(p => {
              const qty = cart[p.id] || 0;
              const isService = isServiceListing(p);
              const outOfStock = !isService && (p.stock ?? 0) <= 0;
              return (
                <div
                  key={p.id}
                  className="group relative bg-white rounded-xl overflow-hidden border border-border hover:shadow-lg transition-all cursor-pointer"
                  data-testid={`gallery-product-${p.id}`}
                  onClick={() => setSelected(p)}
                >
                  {/* Product image */}
                  <div className="aspect-square overflow-hidden bg-slate-100 relative">
                    <img
                      src={getDisplayImage(p)}
                      alt={p.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={e => { if (e.currentTarget.src !== FALLBACK) e.currentTarget.src = FALLBACK; }}
                    />
                    {outOfStock && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="text-white text-[10px] font-black uppercase tracking-widest bg-black/60 px-2 py-1 rounded-full">Out of Stock</span>
                      </div>
                    )}
                    {qty > 0 && (
                      <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-black shadow">
                        {qty}
                      </div>
                    )}
                  </div>
                  {/* Info */}
                  <div className="p-2.5">
                    <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold truncate">{p.category}</p>
                    <p className="font-display font-bold text-emerald-950 text-sm line-clamp-1 mt-0.5">{p.name}</p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="font-display font-black text-base text-emerald-950">₹{p.price}</span>
                      {/* Quick add button */}
                      {!outOfStock && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            if (isService) {
                              handleBookNow(p);
                              return;
                            }
                            addToCart(p.id);
                            toast.success(`${p.name} ${isService ? "booked" : "added"}`);
                          }}
                          className="w-7 h-7 rounded-full bg-emerald-900 text-white flex items-center justify-center hover:bg-emerald-950 shrink-0"
                          data-testid={`quick-add-${p.id}`}
                        >
                          {isService ? <CalendarCheck2 className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Product Detail Modal */}
      {selected && (
        <ProductModal
          product={selected}
          qty={cart[selected.id] || 0}
          galleryUrl={galleryUrl}
          isBookNowRole={isBookNowRole}
          onBookNow={handleBookNow}
          onClose={() => setSelected(null)}
          onAdd={id => { addToCart(id); }}
          onDec={id => { decCart(id); if ((cart[id] || 0) <= 1) setSelected(null); }}
        />
      )}

      {/* Cart bar */}
      {items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-3 bg-white border-t border-border shadow-2xl" data-testid="gallery-cart-bar">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-emerald-800 font-bold flex items-center gap-1.5">
                <ShoppingCart className="w-3.5 h-3.5" /> {items.length} item(s)
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {items.map(i => `${i.name} ×${i.quantity}`).join(", ")}
              </p>
            </div>
            <Button
              onClick={() => setCheckoutOpen(true)}
              className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-5 shrink-0"
              data-testid="gallery-checkout-btn"
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
        paymentConfig={paymentProfile ? {
          upi_id: paymentProfile.upi_id,
          payee_name: paymentProfile.payee_name,
          qr_url: paymentProfile.qr_url,
          label: "Partner UPI Payment",
        } : null}
        isGuest={!user}
        memberRef={guestMemberRef}
        onMemberRefChange={setGuestMemberRef}
        onOrderPlaced={() => { setCheckoutOpen(false); setCart({}); setGuestMemberRef(""); }}
      />
    </div>
  );
}

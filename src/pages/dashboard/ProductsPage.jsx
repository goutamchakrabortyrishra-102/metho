import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShoppingCart, Plus, Minus, Trash2, Upload, Pencil, FileDown } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import AddProductDialog from "@/components/AddProductDialog";
import UpiPaymentDialog from "@/components/UpiPaymentDialog";
import { Button } from "@/components/ui/button";
import { resolveAssetUrl } from "@/lib/utils";

const normalizeCategories = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value.includes("|") ? value.split("|").map((item) => item.trim()).filter(Boolean) : value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
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

export default function ProductsPage() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const placeholder = settings?.product_placeholder_image_url_full;
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState({});
  const [open, setOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [landingTopProductIds, setLandingTopProductIds] = useState([]);
  const [savingTopProducts, setSavingTopProducts] = useState(false);
  const getStock = (product) => Math.max(0, Number(product?.stock ?? 0));

  const loadProducts = () => api.get("/products").then(r => setProducts(r.data));

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    if (isAdmin && searchParams.get("upload") === "1") {
      setUploadOpen(true);
    }
  }, [isAdmin, searchParams]);

  useEffect(() => {
    const raw = settings?.landing_top_product_ids;
    if (!Array.isArray(raw)) {
      setLandingTopProductIds([]);
      return;
    }
    const next = raw
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .slice(0, 6);
    setLandingTopProductIds(next);
  }, [settings?.landing_top_product_ids]);

  const saveLandingTopProductIds = async (nextIds) => {
    setSavingTopProducts(true);
    try {
      await api.put("/settings", { landing_top_product_ids: nextIds });
      setLandingTopProductIds(nextIds);
      toast.success("Landing top products updated");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to update landing top products");
    } finally {
      setSavingTopProducts(false);
    }
  };

  const toggleLandingTopProduct = (product) => {
    const productId = String(product?.id || "").trim();
    if (!productId) return;
    if (String(product?.product_type || "metho").toLowerCase() !== "metho") {
      toast.error("Only METHO products can be shown in landing top products");
      return;
    }
    const exists = landingTopProductIds.includes(productId);
    if (exists) {
      saveLandingTopProductIds(landingTopProductIds.filter((id) => id !== productId));
      return;
    }
    if (landingTopProductIds.length >= 6) {
      toast.error("Maximum 6 top products can be selected");
      return;
    }
    saveLandingTopProductIds([...landingTopProductIds, productId]);
  };

  const deleteProduct = async (product) => {
    if (!window.confirm(`Delete ${product?.name || "this product"}? This cannot be undone.`)) return;
    try {
      await api.delete(`/products/${product.id}`);
      setProducts((prev) => prev.filter((item) => item.id !== product.id));
      setCart((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
      toast.success("Product deleted");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to delete product");
    }
  };

  const openEdit = (product) => {
    setEditingProduct(product);
    setEditOpen(true);
  };

  const inc = (product) => {
    const id = product.id;
    const current = Number(cart[id] || 0);
    const stock = getStock(product);
    if (stock <= 0) {
      toast.error(`${product?.name || "Product"}: out of stock`);
      return;
    }
    if (current >= stock) {
      toast.error(`${product?.name || "Product"}: max available stock is ${stock}`);
      return;
    }
    setCart({ ...cart, [id]: current + 1 });
  };

  const dec = (product) => {
    const id = product.id;
    const current = cart[id] || 0;
    setCart({ ...cart, [id]: Math.max(0, current - 1) });
  };

  useEffect(() => {
    if (!products.length) return;
    setCart((prev) => {
      const next = {};
      Object.entries(prev).forEach(([id, qty]) => {
        const p = products.find((x) => String(x.id) === String(id));
        const stock = getStock(p);
        const normalizedQty = Math.min(Math.max(0, Number(qty) || 0), stock);
        if (normalizedQty > 0) next[id] = normalizedQty;
      });
      return next;
    });
  }, [products]);

  const items = Object.entries(cart).filter(([, q]) => q > 0).map(([id, q]) => {
    const p = products.find(x => x.id === id);
    const subtotal = calcTieredSubtotal(q, p?.price || 0, p?.pricing_tiers || []);
    return { ...p, quantity: q, subtotal };
  });
  const total = items.reduce((s, i) => s + i.subtotal, 0);

  const productCategories = [...new Set(products.map((p) => p.category).filter(Boolean))];
  const configuredCategories = normalizeCategories(settings?.product_categories);
  const categories = [
    ...configuredCategories.filter((category) => productCategories.includes(category)),
    ...productCategories.filter((category) => !configuredCategories.includes(category)).sort((a, b) => a.localeCompare(b)),
  ];
  const filteredProducts = selectedCategory === "all"
    ? products
    : products.filter((p) => p.category === selectedCategory);

  const groupedProducts = categories.map((category) => ({
    category,
    items: products.filter((p) => p.category === category),
  })).filter((g) => g.items.length > 0);

  const productCard = (p, i) => (
    <div key={p.id} className="bg-white rounded-xl border border-border overflow-hidden group hover:shadow-md transition-shadow relative" data-testid={`product-${i}`}>
      {isAdmin ? (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          <button
            onClick={() => openEdit(p)}
            className="w-8 h-8 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-lg"
            data-testid={`edit-product-${i}`}
            title="Edit product"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => deleteProduct(p)}
            className="w-8 h-8 rounded-full text-white flex items-center justify-center shadow-lg bg-amber-500 hover:bg-amber-600"
            data-testid={`delete-product-${i}`}
            title="Delete product"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : null}
      <div className="aspect-square overflow-hidden bg-secondary relative">
        <img
          src={resolveAssetUrl(p.image_url) || placeholder || undefined}
          alt={p.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          onError={(e) => {
            if (placeholder && e.currentTarget.src !== placeholder) {
              e.currentTarget.src = placeholder;
            }
          }}
        />
        <span className={
          "absolute top-2 left-2 text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full " +
          (p.product_type === "associate_partner"
            ? "bg-slate-800 text-white"
            : "bg-amber-500 text-emerald-950")
        }>
          {p.product_type === "associate_partner" ? "Partner" : "METHO"}
        </span>
      </div>
      <div className="p-4">
        <p className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold">{p.category}</p>
        <h4 className="mt-1 font-display font-bold text-emerald-950 text-sm line-clamp-1">{p.name}</h4>
        {p.product_code ? <p className="text-[10px] text-slate-500 mt-1 font-mono">Code: {p.product_code}</p> : null}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-display font-black text-lg text-emerald-950">₹{p.price}</span>
            {Number(p.mrp || 0) > Number(p.price || 0) ? (
              <span className="text-[11px] text-slate-500">
                <span className="line-through mr-1">₹{p.mrp}</span>
                <span className="text-emerald-700 font-semibold">-{Number(p.discount_percent || 0)}%</span>
              </span>
            ) : null}
            {p.product_type === "metho" && Number(p.gst_percent || 0) > 0 ? (
              <span className="text-[10px] text-amber-700 font-semibold">+ GST {Number(p.gst_percent || 0)}%</span>
            ) : null}
            {Array.isArray(p.pricing_tiers) && p.pricing_tiers.length > 0 ? (
              <span className="text-[10px] text-emerald-700 font-semibold">
                Allowed qty: {p.pricing_tiers.map((t) => t.qty).join(", ")}
              </span>
            ) : null}
          </div>
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Stock: {p.stock ?? 0}</span>
        </div>
        {isAdmin ? (
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => openEdit(p)}
              className="rounded-full h-8 text-xs"
              data-testid={`edit-product-row-${i}`}
            >
              <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => deleteProduct(p)}
              className="rounded-full h-8 text-xs border-amber-200 text-amber-700 hover:bg-amber-50"
              data-testid={`delete-product-row-${i}`}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
            </Button>
            {String(p.product_type || "metho").toLowerCase() === "metho" ? (
              <Button
                type="button"
                size="sm"
                variant={landingTopProductIds.includes(String(p.id)) ? "default" : "outline"}
                onClick={() => toggleLandingTopProduct(p)}
                disabled={savingTopProducts}
                className="rounded-full h-8 text-xs"
                data-testid={`toggle-top-product-${i}`}
              >
                {landingTopProductIds.includes(String(p.id))
                  ? `Top #${landingTopProductIds.indexOf(String(p.id)) + 1}`
                  : "Set Top"}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-2">
          {(cart[p.id] || 0) > 0 ? (
            <div className="flex items-center gap-2 flex-1 justify-between bg-emerald-50 rounded-full px-2 py-1">
              <button onClick={() => dec(p)} className="w-7 h-7 rounded-full bg-white hover:bg-emerald-100 flex items-center justify-center" data-testid={`product-dec-${i}`}>
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="font-bold text-emerald-950 text-sm">{cart[p.id]}</span>
              <button onClick={() => inc(p)} className="w-7 h-7 rounded-full bg-white hover:bg-emerald-100 flex items-center justify-center" data-testid={`product-inc-${i}`}>
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Button onClick={() => inc(p)} size="sm" className="w-full bg-emerald-900 hover:bg-emerald-950 rounded-full text-xs" data-testid={`product-add-${i}`}>
              Add to Cart
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6" data-testid="products-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Shop</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Products</h1>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <>
              <Button
                onClick={() => window.open("/shop?view=gallery&autoPdf=1", "_blank")}
                variant="outline"
                className="rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50"
                data-testid="metho-open-gallery-auto-pdf"
              >
                <FileDown className="w-4 h-4 mr-2" /> View Gallery + Auto PDF
              </Button>
              <Button
                onClick={() => setUploadOpen(true)}
                className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full"
                data-testid="open-product-upload-button"
              >
                <Upload className="w-4 h-4 mr-2" /> Product Upload
              </Button>
              <AddProductDialog
                onCreated={loadProducts}
                open={uploadOpen}
                onOpenChange={(v) => {
                  setUploadOpen(v);
                  if (!v && searchParams.get("upload") === "1") {
                    setSearchParams({}, { replace: true });
                  }
                }}
                showTrigger={false}
              />
              <AddProductDialog
                onCreated={loadProducts}
                open={editOpen}
                onOpenChange={(v) => {
                  setEditOpen(v);
                  if (!v) setEditingProduct(null);
                }}
                product={editingProduct}
                showTrigger={false}
              />
            </>
          ) : null}
          {items.length > 0 && (
            <Button
              onClick={() => setOpen(true)}
              className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full"
              data-testid="checkout-button"
            >
              <ShoppingCart className="w-4 h-4 mr-2" /> Checkout ({items.length}) · ₹{total.toLocaleString("en-IN")}
            </Button>
          )}
        </div>
      </div>

      <UpiPaymentDialog
        open={open}
        onOpenChange={setOpen}
        items={items}
        total={total}
        onOrderPlaced={() => {
          setCart({});
          setOpen(false);
        }}
      />

      <div className="flex flex-wrap items-center gap-2" data-testid="product-category-filters">
        <Button
          type="button"
          variant={selectedCategory === "all" ? "default" : "outline"}
          className={selectedCategory === "all" ? "rounded-full" : "rounded-full"}
          onClick={() => setSelectedCategory("all")}
          data-testid="category-all"
        >
          All ({products.length})
        </Button>
        {categories.map((cat) => {
          const count = products.filter((p) => p.category === cat).length;
          return (
            <Button
              key={cat}
              type="button"
              variant={selectedCategory === cat ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setSelectedCategory(cat)}
              data-testid={`category-${cat.replace(/\s+/g, "-").toLowerCase()}`}
            >
              {cat} ({count})
            </Button>
          );
        })}
      </div>

      {selectedCategory === "all" ? (
        <div className="space-y-7" data-testid="products-grouped-by-category">
          {groupedProducts.map((group) => (
            <section key={group.category} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-xl font-bold text-emerald-950">{group.category}</h2>
                <span className="text-xs text-slate-500 font-semibold">{group.items.length} item(s)</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {group.items.map((p, i) => productCard(p, `${group.category}-${i}`))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="products-filtered-grid">
          {filteredProducts.map((p, i) => productCard(p, i))}
        </div>
      )}
    </div>
  );
}


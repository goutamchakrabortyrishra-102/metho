import React, { useState, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Sparkles, Upload, Loader2, Image as ImageIcon, X, Plus, Store, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import api from "@/services/api";
import { useSettings } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { resolveAssetUrl } from "@/lib/utils";

const buildImageUrl = (rawUrl) => {
  return resolveAssetUrl(rawUrl);
};

const CATEGORIES = [
  "Health & Wellness",
  "Beauty & Personal Care",
  "Home & Kitchen",
  "Nutrition",
  "Utilities",
];

const normalizeCategories = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value.includes("|") ? value.split("|").map((item) => item.trim()).filter(Boolean) : value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const firstFilledValue = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return undefined;
};

const calculateGstPreview = (priceBeforeGst, gstPercent) => {
  const price = Math.max(0, Number(priceBeforeGst) || 0);
  const rate = Math.max(0, Number(gstPercent) || 0);
  const gstAmount = Math.round((price * rate / 100) * 100) / 100;
  return {
    priceBeforeGst: price,
    gstPercent: rate,
    gstAmount,
    finalPrice: Math.round(price + gstAmount),
  };
};

export default function AddProductDialog({
  onCreated,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
  triggerText = "Add Product",
  product = null,
  defaultProductType = "metho",
}) {
  const { settings, refresh } = useSettings();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = typeof controlledOpen === "boolean" ? controlledOpen : uncontrolledOpen;
  const setOpen = (next) => {
    if (typeof controlledOpen !== "boolean") setUncontrolledOpen(next);
    onOpenChange && onOpenChange(next);
  };
  const [form, setForm] = useState({
    name: "",
    category: "Health & Wellness",
    price: "",
    purchase_cost: "",
    mrp: "",
    discount_percent: "",
    gst_percent: "",
    stock: "",
    description: "",
    image_url: "",
    product_type: "metho",
    partner_id: "",
    pricing_tiers_input: "",
    youtube_url: "",
    commission_percent: "",
    service_booking_enabled: false,
    service_template_key: "",
    delivery_charge: "",
    free_delivery_threshold: "",
    booking_available_from: "",
    booking_available_until: "",
    unit_type: "piece",
  });
  const [partners, setPartners] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkJson, setBulkJson] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const fileRef = useRef(null);
  const isEdit = Boolean(product?.id);
  const gstPreview = calculateGstPreview(form.price, form.gst_percent);
  const formatPreviewAmount = (value) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

  const categories = useMemo(() => {
    const source = normalizeCategories(settings?.product_categories);
    return (source.length ? source : CATEGORIES)
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index);
  }, [settings?.product_categories]);

  useEffect(() => {
    if (open) api.get("/partners").then(r => setPartners(r.data)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!categories.includes(form.category)) {
      setForm((current) => ({ ...current, category: categories[0] || "Health & Wellness" }));
    }
  }, [categories, form.category]);

  useEffect(() => {
    if (!open) return;
    if (product?.id) {
      setForm({
        name: product.name || "",
        category: product.category || (categories[0] || "Health & Wellness"),
        price: String(product.price ?? ""),
        purchase_cost: String(product.purchase_cost ?? ""),
        mrp: String(product.mrp ?? product.price ?? ""),
        discount_percent: String(product.discount_percent ?? ""),
        gst_percent: String(product.gst_percent ?? ""),
        stock: String(product.stock ?? ""),
        description: product.description || "",
        image_url: product.image_url || "",
        product_type: product.product_type || "metho",
        partner_id: product.partner_id || "",
        pricing_tiers_input: Array.isArray(product.pricing_tiers)
          ? product.pricing_tiers.map((t) => `${t.qty}:${t.price}`).join(", ")
          : "",
        youtube_url: product.youtube_url || "",
        commission_percent: product.commission_percent ?? "",
        service_booking_enabled: Boolean(product.service_booking_enabled),
        service_template_key: product.service_template_key || "",
        delivery_charge: String(product.delivery_charge ?? ""),
        free_delivery_threshold: String(product.free_delivery_threshold ?? ""),
        booking_available_from: product.booking_available_from || "",
        booking_available_until: product.booking_available_until || "",
        unit_type: product.unit_type || "piece",
      });
      return;
    }
    resetForm();
  }, [open, product?.id, categories, defaultProductType]);

  useEffect(() => {
    const mrp = Number(form.mrp || 0);
    const discount = Number(form.discount_percent || 0);
    if (mrp > 0) {
      const nextPrice = Math.max(0, mrp * (1 - (discount / 100)));
      setForm((current) => ({ ...current, price: String(Number(nextPrice.toFixed(2))) }));
    }
  }, [form.mrp, form.discount_percent]);

  const setF = (k) => (e) => setForm({ ...form, [k]: e.target?.value ?? e });

  const resetForm = () => setForm({
    name: "", category: categories[0] || "Health & Wellness", price: "", purchase_cost: "", mrp: "", discount_percent: "", gst_percent: "", stock: "",
    description: "", image_url: "", product_type: defaultProductType, pricing_tiers_input: "", youtube_url: "", commission_percent: "", service_booking_enabled: false, service_template_key: "", delivery_charge: "", free_delivery_threshold: "", booking_available_from: "", booking_available_until: "", unit_type: "piece",
  });

  const parsePricingTiers = (raw) => {
    const text = String(raw || "").trim();
    if (!text) return [];
    const rows = text.split(",").map((x) => x.trim()).filter(Boolean);
    const map = {};
    for (const row of rows) {
      const parts = row.split(/[=:]/).map((x) => x.trim()).filter(Boolean);
      const [qtyRaw, priceRaw] = parts;
      const qty = Number(qtyRaw);
      const price = Number(priceRaw);
      if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price <= 0) continue;
      map[Math.trunc(qty)] = Number(price.toFixed(2));
    }
    return Object.keys(map)
      .map((qty) => ({ qty: Number(qty), price: map[qty] }))
      .sort((a, b) => a.qty - b.qty);
  };

  const toNumberOrNull = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const normalizeBulkRows = (rows) => {
    const normalized = [];
    const errors = [];

    rows.forEach((rawRow, index) => {
      const row = (rawRow && typeof rawRow === "object") ? rawRow : {};
      const name = String(row.name || row.product_name || "").trim();
      const category = String(row.category || row.product_category || "").trim();

      const rawPrice = firstFilledValue(row.price, row.rate, row.selling_price, row.unit_price);
      const rawMrp = firstFilledValue(row.mrp, row.list_price, row.max_price);
      const rawDiscount = firstFilledValue(row.discount_percent, row.discount, row.discount_pct);
      const rawPurchaseCost = firstFilledValue(row.purchase_cost, row.cost, row.purchase_price);
      const rawGst = firstFilledValue(row.gst_percent, row.gst, row.gst_rate);

      let price = toNumberOrNull(rawPrice);
      let mrp = toNumberOrNull(rawMrp);
      let discount = toNumberOrNull(rawDiscount);
      const purchaseCost = Math.max(0, toNumberOrNull(rawPurchaseCost) ?? 0);
      const gst = Math.max(0, toNumberOrNull(rawGst) ?? 0);
      const stock = Math.max(0, Math.trunc(toNumberOrNull(row.stock) ?? 0));

      if (!name) {
        errors.push({ index, error: "name required" });
        return;
      }
      if (!category) {
        errors.push({ index, error: "category required" });
        return;
      }

      if (price === null && mrp !== null) {
        if (discount !== null && discount >= 0 && discount <= 100) {
          price = mrp * (1 - (discount / 100));
        } else {
          price = mrp;
        }
      }

      if (mrp === null && price !== null) mrp = price;

      if (price === null || price <= 0) {
        errors.push({ index, error: "price/rate required and must be > 0" });
        return;
      }

      if (mrp === null || mrp <= 0) mrp = price;

      if (discount === null) {
        if (mrp > 0 && price <= mrp) discount = ((mrp - price) / mrp) * 100;
        else discount = 0;
      }

      const productType = String(row.product_type || "metho").trim() || "metho";
      const partnerId = row.partner_id || null;
      if (productType === "associate_partner" && !partnerId) {
        errors.push({ index, error: "partner_id required for associate_partner" });
        return;
      }
      const pricingTiers = Array.isArray(row.pricing_tiers)
        ? row.pricing_tiers
        : parsePricingTiers(row.pricing_tiers || row.pricing_tiers_input || "");

      normalized.push({
        name,
        category,
        price: Number(price.toFixed(2)),
        purchase_cost: Number(purchaseCost.toFixed(2)),
        mrp: Number(mrp.toFixed(2)),
        discount_percent: Number(Math.max(0, discount).toFixed(2)),
        gst_percent: Number(gst.toFixed(2)),
        stock,
        description: String(row.description || "").trim(),
        image_url: String(row.image_url || "").trim(),
        product_type: productType,
        partner_id: productType === "associate_partner" ? partnerId : null,
        pricing_tiers: pricingTiers,
      });
    });

    return { normalized, errors };
  };

  const saveCategories = async (nextCategories, successMessage) => {
    setSavingCategory(true);
    try {
      await api.put("/settings", { product_categories: nextCategories });
      refresh();
      toast.success(successMessage);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Category update failed");
      throw err;
    } finally {
      setSavingCategory(false);
    }
  };

  const addCategory = async () => {
    const trimmed = newCategory.trim();
    if (!trimmed) {
      toast.error("Enter a new category name");
      return;
    }
    const exists = categories.some((c) => c.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setForm((current) => ({ ...current, category: categories.find((c) => c.toLowerCase() === trimmed.toLowerCase()) || trimmed }));
      setNewCategory("");
      toast.error("That category already exists");
      return;
    }
    try {
      const nextCategories = [...categories, trimmed].sort((a, b) => a.localeCompare(b));
      await saveCategories(nextCategories, "New category added");
      setForm((current) => ({ ...current, category: trimmed }));
      setNewCategory("");
    } catch (err) {
      return;
    }
  };

  const startRenameCategory = (category) => {
    setEditingCategory(category);
    setRenameValue(category);
  };

  const renameCategory = async (category) => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast.error("Enter a new category name");
      return;
    }
    const duplicate = categories.some((item) => item !== category && item.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
      toast.error("That category name already exists");
      return;
    }
    try {
      const nextCategories = categories.map((item) => (item === category ? trimmed : item));
      await saveCategories(nextCategories, "Category renamed");
      if (form.category === category) {
        setForm((current) => ({ ...current, category: trimmed }));
      }
      setEditingCategory("");
      setRenameValue("");
    } catch (err) {
      return;
    }
  };

  const deleteCategory = async (category) => {
    if (categories.length <= 1) {
      toast.error("The last category cannot be deleted");
      return;
    }
    if (!window.confirm(`Delete the "${category}" category?`)) return;
    const nextCategories = categories.filter((item) => item !== category);
    try {
      await saveCategories(nextCategories, "Category deleted");
      if (form.category === category) {
        setForm((current) => ({ ...current, category: nextCategories[0] || "Health & Wellness" }));
      }
      if (editingCategory === category) {
        setEditingCategory("");
        setRenameValue("");
      }
    } catch (err) {
      return;
    }
  };

  const moveCategory = async (category, direction) => {
    const currentIndex = categories.indexOf(category);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= categories.length) return;
    const nextCategories = [...categories];
    [nextCategories[currentIndex], nextCategories[nextIndex]] = [nextCategories[nextIndex], nextCategories[currentIndex]];
    try {
      await saveCategories(nextCategories, "Category order updated");
    } catch (err) {
      return;
    }
  };

  const generateDescription = async () => {
    if (!form.name.trim()) {
      toast.error("Enter a product name first");
      return;
    }
    setGenerating(true);
    try {
      const { data } = await api.post("/admin/products/generate-description", {
        name: form.name,
        category: form.category,
        product_type: form.product_type,
        partner_id: form.product_type === "associate_partner" ? (form.partner_id || null) : null,
        delivery_charge: Math.max(0, Number(form.delivery_charge || 0)),
        free_delivery_threshold: Math.max(0, Number(form.free_delivery_threshold || 0)),
        booking_available_from: form.product_type === "metho_service" ? form.booking_available_from : "",
        booking_available_until: form.product_type === "metho_service" ? form.booking_available_until : "",
        commission_percent: form.product_type === "associate_partner" || form.commission_percent === "" ? null : Number(form.commission_percent),
        service_booking_enabled: form.product_type === "metho_service" && form.service_booking_enabled,
        service_template_key: form.product_type === "metho_service" ? form.service_template_key : "",
      });
      setForm(f => ({ ...f, description: data.description }));
      toast.success("AI description generated ✨");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "AI generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const uploadImage = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return; 
    if (f.size > 5 * 1024 * 1024) {
      toast.error("Image too large (max 5MB)");
      return;
    }
    const readAsDataUrl = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Could not read image"));
        reader.readAsDataURL(file);
      });
    setUploading(true);
    try {
      const embedded = await readAsDataUrl(f);
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/admin/upload/product-image", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const canonical = String(data?.url || data?.image_url || "").trim();
      if (canonical) {
        // Always persist embedded image for refresh-safe rendering even when backend file URLs change.
        setForm(x => ({ ...x, image_url: embedded }));
        toast.success("Image uploaded and saved safely");
      } else {
        throw new Error("Upload response missing url");
      }
    } catch (err) {
      try {
        const embedded = await readAsDataUrl(f);
        setForm(x => ({ ...x, image_url: embedded }));
        toast.success("Image saved locally for reliable display");
      } catch {
        toast.error(err?.response?.data?.detail || "Upload failed");
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name || !form.category || !form.price) {
      toast.error("Name, category, and price are required");
      return;
    }
    if (form.product_type === "associate_partner" && !form.partner_id) {
      toast.error("Associate Partner product-এর জন্য Partner select করা বাধ্যতামূলক");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        pricing_tiers: parsePricingTiers(form.pricing_tiers_input),
        name: form.name,
        category: form.category,
        price: Number(form.price || form.mrp || 0),
        purchase_cost: (form.product_type === "metho" || form.product_type === "metho_vegetable") ? Number(form.purchase_cost || 0) : null,
        mrp: Number(form.mrp || form.price || 0),
        discount_percent: Number(form.discount_percent || 0),
        gst_percent: (form.product_type === "metho" || form.product_type === "metho_vegetable") ? Number(form.gst_percent || 0) : 0,
        bv: 0,
        stock: Number(form.stock || 0),
        description: form.description || "",
        image_url: form.image_url || "",
        youtube_url: form.youtube_url || "",
        product_type: form.product_type,
        partner_id: form.product_type === "associate_partner" ? (form.partner_id || null) : null,
        commission_percent: toNumberOrNull(form.commission_percent),
        delivery_charge: Number(form.delivery_charge || 0),
        free_delivery_threshold: Number(form.free_delivery_threshold || 0),
        unit_type: form.product_type === "metho_vegetable" ? form.unit_type : "piece",
      };
      let data;
      if (isEdit) {
        try {
          const resp = await api.put(`/products/${product.id}`, payload);
          data = resp?.data;
        } catch (err) {
          const status = Number(err?.response?.status || 0);
          if (status === 404 || status === 405) {
            const resp = await api.patch(`/products/${product.id}`, payload);
            data = resp?.data;
          } else {
            throw err;
          }
        }
      } else {
        const resp = await api.post("/products", payload);
        data = resp?.data;
      }
      if (isEdit) {
        toast.success("Product updated!");
      } else if (data?.product_code) {
        toast.success(`Product added! Code: ${data.product_code}`);
      } else {
        toast.success("Product added!");
      }

      const savedProductId = String(data?.id || product?.id || "").trim();
      if (savedProductId && String(form.youtube_url || "").trim()) {
        try {
          await api.patch(`/products/${savedProductId}`, {
            youtube_url: form.youtube_url || "",
          });
        } catch (youtubeErr) {
          const status = Number(youtubeErr?.response?.status || 0);
          if (status !== 404 && status !== 405) {
            throw youtubeErr;
          }
        }
      }

      resetForm();
      setOpen(false);
      onCreated && onCreated();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const importBulkProducts = async () => {
    const raw = String(bulkJson || "").trim();
    if (!raw) {
      toast.error("Paste bulk JSON");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      toast.error("Invalid JSON");
      return;
    }

    const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      toast.error("rows array required");
      return;
    }

    const { normalized, errors: normalizeErrors } = normalizeBulkRows(rows);
    if (normalizeErrors.length > 0) {
      const firstErr = normalizeErrors[0];
      toast.error(`Bulk row error at row ${Number(firstErr.index) + 1}: ${firstErr.error}`);
      return;
    }
    if (normalized.length === 0) {
      toast.error("No valid rows to import");
      return;
    }

    setBulkBusy(true);
    try {
      const { data } = await api.post("/admin/products/bulk-create", { rows: normalized });
      const created = Number(data?.created_count || 0);
      const failed = Number(data?.failed_count || 0);
      if (failed > 0) {
        const firstErr = (Array.isArray(data?.errors) && data.errors[0]) ? data.errors[0] : null;
        toast.error(`Bulk: ${created} created, ${failed} failed${firstErr ? ` (row ${Number(firstErr.index) + 1}: ${firstErr.error})` : ""}`);
      } else {
        toast.success(`Bulk import success: ${created} products created`);
      }
      setBulkJson("");
      onCreated && onCreated();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Bulk import failed");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <DialogTrigger asChild>
          <Button className="bg-emerald-900 hover:bg-emerald-950 rounded-full" data-testid="add-product-button">
            <Plus className="w-4 h-4 mr-2" /> {triggerText}
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Product" : "Add New Product"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Edit product তথ্য আপডেট করুন" : "নতুন product details দিয়ে save করুন"}
          </DialogDescription>
        </DialogHeader>
        {isEdit ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900" data-testid="edit-flow-note">
            আগে Product-এর তথ্য edit করে <b>Update Product</b> দিন। পরে আবার Edit খুলে একইভাবে একটার পর একটা image upload/change করতে পারবেন।
          </div>
        ) : null}
        <form onSubmit={save} className="space-y-4" data-testid="add-product-form">
          {!isEdit ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3" data-testid="bulk-product-import-panel">
              <p className="text-xs uppercase tracking-wider text-amber-900 font-semibold">METHO Bulk Product Import</p>
              <p className="text-[11px] text-amber-900/80 mt-1">JSON array paste করুন। Required: name, category, এবং price/rate/mrp যেকোনো একটি। Logic: rate = price ধরা হবে, mrp+discount থাকলে auto price হিসাব হবে। Optional: stock, description, image_url, gst_percent, product_type, partner_id, pricing_tiers.</p>
              <Textarea
                value={bulkJson}
                onChange={(e) => setBulkJson(e.target.value)}
                placeholder='[{"name":"METHO Honey","category":"Nutrition","rate":550,"mrp":650,"gst":5,"stock":50}]'
                rows={5}
                className="mt-2 bg-white"
                data-testid="bulk-product-json-input"
              />
              <div className="mt-2 flex justify-end">
                <Button type="button" variant="outline" className="rounded-full" disabled={bulkBusy} onClick={importBulkProducts} data-testid="bulk-product-import-button">
                  {bulkBusy ? "Importing..." : "Import Bulk Products"}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <Label>Product Name *</Label>
              <Input
                required
                value={form.name}
                onChange={setF("name")}
                placeholder="e.g., METHO Organic Turmeric"
                data-testid="new-product-name-input"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger className="mt-1.5" data-testid="new-product-category-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="mt-2 flex gap-2">
                <Input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="New category name"
                  data-testid="new-category-input"
                />
                <Button
                  type="button"
                  onClick={addCategory}
                  disabled={savingCategory}
                  variant="outline"
                  className="rounded-full"
                  data-testid="add-category-button"
                >
                  {savingCategory ? "Adding..." : "Add Category"}
                </Button>
              </div>
              <div className="mt-3 space-y-2 rounded-xl border border-border bg-slate-50 p-3" data-testid="category-manager">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Manage Categories</p>
                {categories.map((category, index) => (
                  <div key={category} className="flex items-center gap-2">
                    {editingCategory === category ? (
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        data-testid={`rename-category-input-${category.replace(/\s+/g, "-").toLowerCase()}`}
                      />
                    ) : (
                      <div className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm text-slate-700">{category}</div>
                    )}
                    {editingCategory === category ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-full"
                          disabled={savingCategory}
                          onClick={() => renameCategory(category)}
                        >
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="rounded-full"
                          onClick={() => { setEditingCategory(""); setRenameValue(""); }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-full"
                          disabled={savingCategory || index === 0}
                          onClick={() => moveCategory(category, -1)}
                          data-testid={`move-up-category-button-${category.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-full"
                          disabled={savingCategory || index === categories.length - 1}
                          onClick={() => moveCategory(category, 1)}
                          data-testid={`move-down-category-button-${category.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-full"
                          disabled={savingCategory}
                          onClick={() => startRenameCategory(category)}
                          data-testid={`rename-category-button-${category.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Rename
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-full border-red-200 text-red-700 hover:bg-red-50"
                          disabled={savingCategory}
                          onClick={() => deleteCategory(category)}
                          data-testid={`delete-category-button-${category.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label>Purchase Cost - Admin Only (₹)</Label>
              <Input type="number" min="0" value={form.purchase_cost} onChange={setF("purchase_cost")} data-testid="new-product-purchase-cost-input" className="mt-1.5" placeholder="0" />
            </div>
            <div>
              <Label>MRP (₹) *</Label>
              <Input required type="number" value={form.mrp} onChange={setF("mrp")} data-testid="new-product-mrp-input" className="mt-1.5" />
            </div>
            <div>
              <Label>Discount %</Label>
              <Input type="number" value={form.discount_percent} onChange={setF("discount_percent")} data-testid="new-product-discount-input" className="mt-1.5" placeholder="0" />
            </div>
            <div>
              <Label>Price Before GST / Selling Price (₹) *</Label>
              <Input required type="number" value={form.price} onChange={setF("price")} data-testid="new-product-price-input" className="mt-1.5" />
            </div>
            <div>
              <Label>{form.product_type === "metho_vegetable" && form.unit_type !== "piece" ? `Stock (${form.unit_type})` : "Stock"}</Label>
              <Input type="number" value={form.stock} onChange={setF("stock")} data-testid="new-product-stock-input" className="mt-1.5" placeholder="0" />
            </div>
          </div>

          {form.product_type === "metho_vegetable" ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <Label>Vegetable Sales Unit</Label>
              <Select value={form.unit_type} onValueChange={(unit_type) => setForm({ ...form, unit_type })}>
                <SelectTrigger className="mt-1.5 max-w-sm" data-testid="vegetable-unit-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">Kilogram (cart starts at 100g)</SelectItem>
                  <SelectItem value="gram">Gram (cart starts at 100g)</SelectItem>
                  <SelectItem value="piece">Piece (e.g. cauliflower)</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-2 text-[11px] text-emerald-900">
                {form.unit_type === "piece" ? "Customer can order 1, 2, 3 pieces." : `Rate is per ${form.unit_type}; customer quantity starts at ${form.unit_type === "kg" ? "0.1 kg (100g)" : "100g"}.`}
              </p>
            </div>
          ) : null}

          {(form.product_type === "metho" || form.product_type === "metho_vegetable") && (
            <div>
              <Label>GST % (METHO / METHO Vegetable product)</Label>
              <Input type="number" value={form.gst_percent} onChange={setF("gst_percent")} data-testid="new-product-gst-input" className="mt-1.5 max-w-xs" placeholder="e.g. 18" />
              <div className="mt-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4" data-testid="gst-final-price-preview">
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-800 font-bold">GST &amp; FINAL PRICE PREVIEW</p>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <div className="flex justify-between gap-4"><span>Price Before GST:</span><span className="font-semibold">₹{formatPreviewAmount(gstPreview.priceBeforeGst)}</span></div>
                  <div className="flex justify-between gap-4"><span>GST ({gstPreview.gstPercent}%):</span><span className="font-semibold">₹{formatPreviewAmount(gstPreview.gstAmount)}</span></div>
                  <div className="flex justify-between gap-4 border-t border-emerald-200 pt-2 text-base"><span className="font-bold text-emerald-950">Final Selling Price:</span><span className="font-black text-2xl text-emerald-800">₹{formatPreviewAmount(gstPreview.finalPrice)}</span></div>
                  <p className="text-right text-[11px] font-semibold text-emerald-700">GST-inclusive rounded final rate</p>
                  <div className="flex justify-between gap-4 border-t border-emerald-200 pt-2 text-xs"><span>Purchase Cost - Admin Only:</span><span className="font-bold text-slate-800">₹{formatPreviewAmount(form.purchase_cost)}</span></div>
                </div>
              </div>
            </div>
          )}

          {(form.product_type === "metho" || form.product_type === "metho_vegetable" || form.product_type === "metho_service" || form.product_type === "associate_partner") && (
            <div>
              <Label>Pack / Tier Pricing (qty=price)</Label>
              <Input
                value={form.pricing_tiers_input}
                onChange={setF("pricing_tiers_input")}
                data-testid="new-product-tier-pricing-input"
                className="mt-1.5"
                placeholder="1=100, 3=290, 6=550"
              />
              <p className="text-[11px] text-muted-foreground mt-1.5 font-body">
                উদাহরণ: 1=100, 3=290, 6=550 অথবা 1:100, 3:290, 6:550
              </p>
            </div>
          )}

          <div>
            <Label>Product Type</Label>
            <Select value={form.product_type} onValueChange={(v) => setForm({ ...form, product_type: v, partner_id: v === "associate_partner" ? form.partner_id : "", service_booking_enabled: v === "metho_service", service_template_key: v === "metho_service" ? "tourism_booking" : "" })}>
              <SelectTrigger className="mt-1.5" data-testid="new-product-type-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="metho">METHO Product (Smart Cycle qualified)</SelectItem>
                <SelectItem value="metho_vegetable">METHO Vegetable (separate page, Smart Cycle qualified)</SelectItem>
                <SelectItem value="metho_service" disabled={!isEdit}>METHO Service (use Tourism Control Center)</SelectItem>
                <SelectItem value="associate_partner">Associate Partner Product</SelectItem>
              </SelectContent>
            </Select>
            {!isEdit ? <p className="mt-1.5 text-[11px] text-sky-800">Tourism offers are created from Tourism Control Center so image, itinerary, and public booking details stay together.</p> : null}
            {form.product_type === "associate_partner" && (
              <div className="mt-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
                <Label className="flex items-center gap-1.5 text-amber-900"><Store className="w-3.5 h-3.5" /> Link to Partner <span className="text-red-500">*</span></Label>
                <Select value={form.partner_id} onValueChange={(v) => setForm({ ...form, partner_id: v })}>
                  <SelectTrigger className="mt-1.5 bg-white" data-testid="product-partner-select">
                    <SelectValue placeholder="Select an Associate Partner..." />
                  </SelectTrigger>
                  <SelectContent>
                    {partners.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-slate-500">
                        No partners yet — <a href="/app/partners" className="text-emerald-800 underline">register one first</a>
                      </div>
                    ) : (
                      partners.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.business_name} · {p.commission_percent}% commission
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {form.partner_id && (() => {
                  const p = partners.find(x => x.id === form.partner_id);
                  return p ? <p className="text-[11px] text-amber-900 mt-2">
                    Commission on every sale: <b>{p.commission_percent}%</b> → contributes to Company + Pools
                  </p> : null;
                })()}
              </div>
            )}
          </div>

          {form.product_type !== "associate_partner" && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <div>
                <Label>Product / Service Smart Cycle Commission % (Admin set)</Label>
                <Input type="number" min="0" max="100" step="0.01" value={form.commission_percent} onChange={setF("commission_percent")} className="mt-1.5 max-w-xs bg-white" placeholder="Blank = default METHO rate" data-testid="product-commission-percent-input" />
                <p className="mt-1 text-[11px] text-emerald-800">প্রতিটি METHO product বা service-এর আলাদা Slot 5 payout rate। খালি রাখলে global METHO default rate ব্যবহার হবে।</p>
              </div>
              {form.product_type === "metho_service" && (
                <>
                  <label className="flex items-center gap-2 text-sm font-medium text-emerald-950">
                    <input type="checkbox" checked={form.service_booking_enabled} onChange={(e) => setForm({ ...form, service_booking_enabled: e.target.checked })} data-testid="metho-service-booking-enabled" />
                    Enable date & time booking
                  </label>
                  <div>
                    <Label>Service template</Label>
                    <Select value={form.service_template_key || "tourism_booking"} onValueChange={(v) => setForm({ ...form, service_template_key: v })}>
                      <SelectTrigger className="mt-1.5 bg-white" data-testid="metho-service-template-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tourism_booking">Tourism booking</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
            <Label>Delivery Charge per Unit (₹)</Label>
            <Input type="number" min="0" step="0.01" value={form.delivery_charge} onChange={setF("delivery_charge")} className="mt-1.5 max-w-xs bg-white" placeholder="0 = Free Delivery" data-testid="product-delivery-charge" />
            <Label className="mt-2 block">Free Delivery Above Cart Total (₹)</Label>
            <Input type="number" min="0" step="0.01" value={form.free_delivery_threshold} onChange={setF("free_delivery_threshold")} className="mt-1.5 max-w-xs bg-white" placeholder="0 = no threshold" data-testid="product-free-delivery-threshold" />
            <p className="mt-1 text-[11px] text-sky-800">Cart subtotal এই limit-এ পৌঁছালে delivery free হবে। Quantity যতই হোক, এক cart-এ charge একবারই।</p>
          </div>
          {form.product_type === "metho_service" ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold text-amber-950">Tour Booking Availability</p><div className="mt-2 grid gap-3 sm:grid-cols-2"><div><Label>Available From</Label><Input type="datetime-local" value={form.booking_available_from} onChange={setF("booking_available_from")} className="mt-1.5 bg-white" data-testid="tourism-available-from" /></div><div><Label>Available Until</Label><Input type="datetime-local" value={form.booking_available_until} onChange={setF("booking_available_until")} className="mt-1.5 bg-white" data-testid="tourism-available-until" /></div></div><p className="mt-1 text-[11px] text-amber-800">Customer শুধু এই preset date range-এর মধ্যে booking date দিতে পারবে।</p></div> : null}

          {/* Description with AI generator */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>Description</Label>
              <Button
                type="button"
                onClick={generateDescription}
                disabled={generating || !form.name.trim()}
                variant="outline"
                size="sm"
                className="h-8 text-xs rounded-full border-amber-400 text-amber-800 hover:bg-amber-50"
                data-testid="ai-generate-description-button"
              >
                {generating ? (
                  <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Generating...</>
                ) : (
                  <><Sparkles className="w-3 h-3 mr-1" /> AI দিয়ে লিখুন</>
                )}
              </Button>
            </div>
            <Textarea
              value={form.description}
              onChange={setF("description")}
              placeholder="Product description... (AI দিয়েও লেখানো যাবে)"
              rows={3}
              data-testid="new-product-description-input"
            />
          </div>

          <div>
            <Label>YouTube Link (Optional)</Label>
            <Input
              value={form.youtube_url}
              onChange={setF("youtube_url")}
              placeholder="https://www.youtube.com/watch?v=..."
              data-testid="new-product-youtube-input"
              className="mt-1.5"
            />
          </div>

          {/* Image upload */}
          <div>
            <Label>{form.product_type === "metho_service" ? "Tour Image / Poster (mobile/PC থেকে upload)" : "Product Image (mobile/PC থেকে upload)"}</Label>
            <div className="mt-1.5 flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={uploadImage}
                className="hidden"
                id="product-image-input"
                data-testid="new-product-image-input"
              />
              <Button
                type="button"
                onClick={() => fileRef.current?.click()}
                variant="outline"
                disabled={uploading}
                className="rounded-full border-emerald-900/20 hover:bg-emerald-50"
                data-testid="upload-image-button"
              >
                {uploading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" /> Choose Image</>
                )}
              </Button>
              {form.image_url ? (
                <div className="relative">
                  <img
                    src={buildImageUrl(form.image_url)}
                    alt="Preview"
                    className="w-20 h-20 rounded-lg object-cover border border-border"
                    data-testid="uploaded-image-preview"
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, image_url: "" })}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-lg bg-secondary/50 border border-dashed border-border flex items-center justify-center">
                  <ImageIcon className="w-6 h-6 text-slate-400" />
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 font-body">JPG / PNG / WebP · max 5 MB{form.product_type === "metho_service" ? " · poster-এর জন্য 4:3 বা 16:10 image ভালো দেখাবে" : ""}</p>
            {isEdit ? (
              <p className="text-[11px] text-emerald-700 mt-1 font-body">Image change করতে চাইলে নতুন image upload করে Update Product দিলেই পুরোনো image replace হবে।</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="submit"
              disabled={saving}
              className="bg-emerald-900 hover:bg-emerald-950 rounded-full"
              data-testid="save-product-button"
            >
              {saving ? "Saving..." : (isEdit ? "Update Product" : "Save Product")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


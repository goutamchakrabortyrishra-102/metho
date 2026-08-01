import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Loader2, Upload, Image as ImageIcon, X } from "lucide-react";
import { jsPDF } from "jspdf";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { resolveAssetUrl } from "@/lib/utils";

const EMPTY = {
  name: "",
  category: "General",
  price: "",
  stock: "",
  discount_percent: "",
  gst_percent: "",
  description: "",
  image_url: "",
  pdf_url: "",
  listing_type: "product",
};

const PARTNER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const resolveListingType = (item) => {
  if (!item) return "product";
  const hint = [item?.listing_type, item?.item_kind, item?.kind, item?.type, item?.product_kind]
    .find((v) => typeof v === "string" && v.trim());
  if (String(hint || "").toLowerCase().includes("service")) return "service";
  if (item?.is_service === true || item?.service_booking_enabled === true) return "service";
  return "product";
};

const toDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(new Error("File read failed"));
  reader.readAsDataURL(file);
});

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("Image load failed"));
  img.src = src;
});

const imageToPdfBlob = async (file) => {
  const rawDataUrl = await toDataUrl(file);
  const img = await loadImage(rawDataUrl);

  const maxSide = 1400;
  const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * ratio));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.88);

  const orientation = w >= h ? "landscape" : "portrait";
  const pdf = new jsPDF({ orientation, unit: "pt", format: [w, h] });
  pdf.addImage(jpegDataUrl, "JPEG", 0, 0, w, h, undefined, "FAST");
  return pdf.output("blob");
};

export default function PartnerProductForm({ product, onSaved, disabled = false, disabledReason = "" }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(product || EMPTY);
  const [busy, setBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    const source = product || EMPTY;
    setForm({ ...EMPTY, ...source, listing_type: resolveListingType(source) });
    setLocalPreviewUrl("");
  }, [product]);

  useEffect(() => () => {
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
  }, [localPreviewUrl]);

  const resolveImageUrl = (url) => {
    return resolveAssetUrl(url);
  };

  const uploadImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > PARTNER_IMAGE_MAX_BYTES) {
      toast.error("File too large (max 5MB)");
      return;
    }
    setUploadingImage(true);
    try {
      const preview = URL.createObjectURL(file);
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
      setLocalPreviewUrl(preview);

      const imageFd = new FormData();
      imageFd.append("file", file);
      const imageRes = await api.post("/partner/upload/product-image", imageFd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const imageData = imageRes?.data || {};
      const imageUrl = resolveImageUrl(imageData?.url || imageData?.image_url || "");
      if (!imageUrl) {
        throw new Error("Image upload response missing url");
      }

      const pdfBlob = await imageToPdfBlob(file);
      const pdfFile = new File([pdfBlob], `${Date.now()}-catalog.pdf`, { type: "application/pdf" });

      let uploaded = null;
      const endpoints = ["/partner/upload/product-pdf", "/admin/upload/product-pdf"];
      for (const endpoint of endpoints) {
        try {
          const fd = new FormData();
          fd.append("file", pdfFile);
          uploaded = await api.post(endpoint, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          break;
        } catch (uploadErr) {
          const status = Number(uploadErr?.response?.status || 0);
          if (status !== 401 && status !== 403 && status !== 404) throw uploadErr;
        }
      }

      const data = uploaded?.data || {};
      const pdfUrl = resolveImageUrl(data?.pdf_url || data?.url || data?.file_url || data?.link || "");
      setForm((prev) => ({
        ...prev,
        image_url: imageUrl,
        pdf_url: pdfUrl || prev.pdf_url || "",
      }));
      if (pdfUrl) toast.success("Image uploaded and auto-converted to PDF");
      else toast.success("Image uploaded. PDF link was not returned by server.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Image/PDF upload failed.");
    } finally {
      setUploadingImage(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!String(form.image_url || "").trim()) {
      toast.error("Listing image required. Please upload image first.");
      return;
    }
    setBusy(true);
    try {
      const isService = form.listing_type === "service";
      const payload = {
        ...form,
        price: Number(form.price),
        stock: Number(form.stock || (isService ? 1 : 0)),
        discount_percent: Number(form.discount_percent || 0),
        gst_percent: Number(form.gst_percent || 0),
        image_url: String(form.image_url || "").trim(),
        listing_type: isService ? "service" : "product",
        item_kind: isService ? "service" : "product",
        is_service: isService,
        service_booking_enabled: isService,
      };

      let saved = null;
      if (product?.id) saved = await api.put(`/partner/products/${product.id}`, payload);
      else saved = await api.post("/partner/products", payload);

      toast.success(product?.id ? "Listing updated and live" : "Image uploaded and live in gallery");
      setOpen(false);
      onSaved?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full"
          data-testid={product?.id ? `edit-my-product-${product.id}` : "add-my-product"}
          disabled={!product?.id && disabled}
          title={!product?.id && disabled && disabledReason ? disabledReason : undefined}
        >
          {product?.id ? <Pencil className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />} {product?.id ? "Edit Listing" : "Image Upload"}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg sm:max-w-2xl max-h-[88vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{product?.id ? "Edit Listing" : "New Listing"}</DialogTitle>
          <DialogDescription>
            {product?.id ? "Update partner listing details and optionally replace the image, which is saved as a PDF link." : "Create a new partner shop/service listing. The uploaded image is saved as a PDF link."}
          </DialogDescription>
        </DialogHeader>
        {product?.id ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900" data-testid="partner-edit-flow-note">
            Update the listing details first, then save changes. You can reopen Edit later and replace the image whenever needed.
          </div>
        ) : null}
        <form onSubmit={save} className="space-y-3" data-testid="partner-product-form">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Listing Type *</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2" data-testid="my-listing-type">
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, listing_type: "product" }))}
                  className={`h-10 rounded-md border text-sm font-semibold ${form.listing_type === "product" ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-border bg-white text-slate-700"}`}
                >
                  Product
                </button>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, listing_type: "service", stock: prev.stock || "1" }))}
                  className={`h-10 rounded-md border text-sm font-semibold ${form.listing_type === "service" ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-border bg-white text-slate-700"}`}
                >
                  Service
                </button>
              </div>
            </div>
            <div>
              <Label>{form.listing_type === "service" ? "Service Name *" : "Product Name *"}</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" data-testid="my-prod-name" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Category *</Label><Input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1" data-testid="my-prod-cat" /></div>
            <div><Label>PDF Link</Label><Input value={form.pdf_url || ""} onChange={(e) => setForm({ ...form, pdf_url: e.target.value })} className="mt-1" placeholder="https://...pdf" data-testid="my-prod-pdf" /></div>
          </div>
          <div>
              <Label>Image Upload (Saved as PDF)</Label>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={uploadImage}
                className="hidden"
                data-testid={product?.id ? "partner-edit-product-image-input" : "partner-add-product-image-input"}
              />
              <Button
                type="button"
                onClick={() => fileRef.current?.click()}
                variant="outline"
                disabled={uploadingImage}
                className="rounded-full w-full sm:w-auto"
                data-testid={product?.id ? "partner-edit-product-image-upload-button" : "partner-add-product-image-upload-button"}
              >
                {uploadingImage ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" /> {product?.id ? "Change Image (saved as PDF)" : "Image Upload (saved as PDF)"}</>
                )}
              </Button>
              {localPreviewUrl || form.image_url || form.pdf_url ? (
                <div className="relative">
                  <img
                    src={localPreviewUrl || form.image_url || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23f1f5f9'/><rect x='80' y='50' width='240' height='300' rx='14' fill='%23ffffff' stroke='%2394a3b8' stroke-width='4'/><text x='200' y='190' text-anchor='middle' fill='%23dc2626' font-size='46' font-family='Arial' font-weight='bold'>PDF</text></svg>"}
                    alt="Product preview"
                    className="w-16 h-16 rounded-lg border border-border object-cover"
                    data-testid={product?.id ? "partner-edit-product-image-preview" : "partner-add-product-image-preview"}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, image_url: "", pdf_url: "" }));
                      if (localPreviewUrl) {
                        URL.revokeObjectURL(localPreviewUrl);
                        setLocalPreviewUrl("");
                      }
                    }}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600"
                    data-testid={product?.id ? "partner-edit-product-image-remove" : "partner-add-product-image-remove"}
                    aria-label="Remove image"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="w-16 h-16 rounded-lg bg-secondary/50 border border-dashed border-border flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-slate-400" />
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">JPG/PNG/WebP/GIF/SVG, max 5MB. Image stays visible in gallery/cart and is also auto-converted to PDF when supported.</p>
            {form.pdf_url ? (
              <p className="text-[11px] text-emerald-700 mt-1 break-all">PDF: {form.pdf_url}</p>
            ) : null}
            {product?.id ? (
              <p className="text-[11px] text-emerald-700 mt-1">If you upload a new image, it will be saved as a PDF link.</p>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>{form.listing_type === "service" ? "Booking Price (₹) *" : "Price (₹) *"}</Label><Input type="number" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="mt-1" data-testid="my-prod-price" /></div>
            <div><Label>{form.listing_type === "service" ? "Daily Slot / Capacity" : "Stock"}</Label><Input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="mt-1" data-testid="my-prod-stock" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Discount (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={form.discount_percent}
                onChange={(e) => setForm({ ...form, discount_percent: e.target.value })}
                className="mt-1"
                data-testid="my-prod-discount"
              />
            </div>
            <div>
              <Label>GST (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={form.gst_percent}
                onChange={(e) => setForm({ ...form, gst_percent: e.target.value })}
                className="mt-1"
                data-testid="my-prod-gst"
              />
            </div>
          </div>
          <div><Label>{form.listing_type === "service" ? "Service Description" : "Description"}</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1" data-testid="my-prod-desc" /></div>
          <DialogFooter>
            <Button type="submit" disabled={busy} className="bg-emerald-900 hover:bg-emerald-950 text-white" data-testid="my-prod-save">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (product?.id ? "Update Product" : "Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


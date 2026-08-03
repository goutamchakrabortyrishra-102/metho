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
  unit_type: "piece",
  service_invoice_mode: "detailed",
  service_template_key: "",
};

const UNIT_OPTIONS = [
  { value: "piece", label: "Per Piece" },
  { value: "kg", label: "Per Kg" },
  { value: "gram", label: "Per Gram" },
  { value: "litre", label: "Per Litre" },
  { value: "ml", label: "Per ML" },
];

const SERVICE_TEMPLATES = [
  {
    key: "hotel_standard_room",
    sector: "Hotel",
    name: "Standard Room Booking",
    category: "Service / Hotel",
    price: 1800,
    stock: 12,
    description: "Per-night room booking with check-in/check-out support. Ideal for small to mid-size hotels.",
  },
  {
    key: "hotel_deluxe_room",
    sector: "Hotel",
    name: "Deluxe Room Booking",
    category: "Service / Hotel",
    price: 3200,
    stock: 8,
    description: "Deluxe room with premium amenities. Use daily capacity as available room count.",
  },
  {
    key: "hotel_suite_room",
    sector: "Hotel",
    name: "Suite Room Booking",
    category: "Service / Hotel",
    price: 4800,
    stock: 5,
    description: "Suite room booking template for premium guests and family stays.",
  },
  {
    key: "homestay_daily_stay",
    sector: "Homestay",
    name: "Homestay Daily Stay",
    category: "Service / Homestay",
    price: 1400,
    stock: 6,
    description: "Homestay stay booking per day with basic guest support and check-in details.",
  },
  {
    key: "homestay_weekend_package",
    sector: "Homestay",
    name: "Homestay Weekend Package",
    category: "Service / Homestay",
    price: 3200,
    stock: 4,
    description: "Weekend stay package template with flexible occupancy.",
  },
  {
    key: "doctor_consultation",
    sector: "Doctor Clinic",
    name: "Doctor Consultation Slot",
    category: "Service / Clinic",
    price: 700,
    stock: 30,
    description: "Consultation booking slot for clinic patients. Capacity indicates slots per day.",
  },
  {
    key: "diagnostic_visit",
    sector: "Doctor Clinic",
    name: "Diagnostic Follow-up Visit",
    category: "Service / Clinic",
    price: 450,
    stock: 20,
    description: "Follow-up or test-review visit booking for clinic operations.",
  },
  {
    key: "tele_consultation",
    sector: "Doctor Clinic",
    name: "Tele Consultation",
    category: "Service / Clinic",
    price: 500,
    stock: 40,
    description: "Online consultation slot for remote patients.",
  },
  {
    key: "dental_checkup",
    sector: "Dental",
    name: "Dental Checkup",
    category: "Service / Dental",
    price: 600,
    stock: 25,
    description: "Routine dental consultation and oral screening template.",
  },
  {
    key: "pathology_test_slot",
    sector: "Diagnostic Center",
    name: "Pathology Test Slot",
    category: "Service / Diagnostic",
    price: 350,
    stock: 60,
    description: "Sample collection or diagnostic test booking slot.",
  },
  {
    key: "ultrasound_slot",
    sector: "Diagnostic Center",
    name: "Ultrasound Appointment",
    category: "Service / Diagnostic",
    price: 1200,
    stock: 15,
    description: "Ultrasound appointment booking with limited daily capacity.",
  },
  {
    key: "restaurant_table_booking",
    sector: "Restaurant",
    name: "Restaurant Table Booking",
    category: "Service / Restaurant",
    price: 500,
    stock: 25,
    description: "Table reservation booking. Capacity can represent total bookable tables per slot.",
  },
  {
    key: "banquet_slot",
    sector: "Restaurant",
    name: "Event / Banquet Slot Booking",
    category: "Service / Restaurant",
    price: 3500,
    stock: 4,
    description: "Banquet or private event slot booking for party/date-based reservations.",
  },
  {
    key: "restaurant_takeaway_slot",
    sector: "Restaurant",
    name: "Takeaway Pickup Slot",
    category: "Service / Restaurant",
    price: 200,
    stock: 40,
    description: "Order pickup slot template for busy food outlets.",
  },
  {
    key: "cafe_table_reservation",
    sector: "Cafe",
    name: "Cafe Table Reservation",
    category: "Service / Cafe",
    price: 300,
    stock: 20,
    description: "Cafe seating reservation template for peak-hour management.",
  },
  {
    key: "salon_haircut",
    sector: "Salon",
    name: "Salon Haircut Service",
    category: "Service / Salon",
    price: 350,
    stock: 35,
    description: "Professional haircut appointment template for men/women/kids.",
  },
  {
    key: "salon_grooming_package",
    sector: "Salon",
    name: "Salon Grooming Package",
    category: "Service / Salon",
    price: 1200,
    stock: 15,
    description: "Package booking template for facial, grooming, and combo services.",
  },
  {
    key: "salon_bridal_package",
    sector: "Salon",
    name: "Bridal Makeover Package",
    category: "Service / Salon",
    price: 6500,
    stock: 6,
    description: "Bridal makeup and grooming package booking template.",
  },
  {
    key: "spa_session",
    sector: "Spa",
    name: "Spa Therapy Session",
    category: "Service / Spa",
    price: 1800,
    stock: 12,
    description: "Therapy and relaxation session booking for spa centers.",
  },
  {
    key: "gym_personal_training",
    sector: "Fitness",
    name: "Personal Training Session",
    category: "Service / Fitness",
    price: 900,
    stock: 35,
    description: "One-on-one gym or fitness coaching session template.",
  },
  {
    key: "yoga_class_slot",
    sector: "Fitness",
    name: "Yoga Class Slot",
    category: "Service / Fitness",
    price: 400,
    stock: 40,
    description: "Daily yoga class slot booking for studio-based sessions.",
  },
  {
    key: "tuition_monthly_batch",
    sector: "Education",
    name: "Tuition Monthly Batch",
    category: "Service / Education",
    price: 1500,
    stock: 50,
    description: "Monthly tuition batch enrollment template.",
  },
  {
    key: "coaching_mock_test",
    sector: "Education",
    name: "Coaching Mock Test",
    category: "Service / Education",
    price: 250,
    stock: 100,
    description: "Exam mock test registration template for coaching centers.",
  },
  {
    key: "ac_service_visit",
    sector: "Home Service",
    name: "AC Service Visit",
    category: "Service / Home Repair",
    price: 700,
    stock: 25,
    description: "Air-conditioner servicing and maintenance visit template.",
  },
  {
    key: "plumbing_repair",
    sector: "Home Service",
    name: "Plumbing Repair Service",
    category: "Service / Home Repair",
    price: 600,
    stock: 25,
    description: "On-demand plumbing repair booking for homes and shops.",
  },
  {
    key: "electrician_visit",
    sector: "Home Service",
    name: "Electrician Visit",
    category: "Service / Home Repair",
    price: 650,
    stock: 25,
    description: "Electrical repair and fitting service appointment template.",
  },
  {
    key: "appliance_repair",
    sector: "Home Service",
    name: "Home Appliance Repair",
    category: "Service / Home Repair",
    price: 800,
    stock: 20,
    description: "Washing machine, fridge, and small appliance repair template.",
  },
  {
    key: "laundry_kg_service",
    sector: "Laundry",
    name: "Laundry Wash and Fold",
    category: "Service / Laundry",
    price: 250,
    stock: 50,
    description: "Daily laundry service booking template with pickup options.",
  },
  {
    key: "dry_clean_service",
    sector: "Laundry",
    name: "Dry Clean Service",
    category: "Service / Laundry",
    price: 400,
    stock: 35,
    description: "Garment dry cleaning order template.",
  },
  {
    key: "tailoring_stitching",
    sector: "Tailoring",
    name: "Custom Stitching Order",
    category: "Service / Tailoring",
    price: 900,
    stock: 20,
    description: "Custom clothing stitching and alteration booking template.",
  },
  {
    key: "beauty_home_service",
    sector: "Beauty at Home",
    name: "Home Beauty Service",
    category: "Service / Beauty",
    price: 1200,
    stock: 18,
    description: "At-home beauty, grooming, and makeup service appointment.",
  },
  {
    key: "photo_event_shoot",
    sector: "Photography",
    name: "Event Photography Session",
    category: "Service / Photography",
    price: 5000,
    stock: 10,
    description: "Event or ceremony photography booking template.",
  },
  {
    key: "video_shoot_edit",
    sector: "Photography",
    name: "Video Shoot and Edit",
    category: "Service / Photography",
    price: 9000,
    stock: 8,
    description: "Video shooting and editing package booking template.",
  },
  {
    key: "cab_airport_drop",
    sector: "Transport",
    name: "Airport Drop Ride",
    category: "Service / Transport",
    price: 1200,
    stock: 20,
    description: "Airport transfer ride booking template.",
  },
  {
    key: "car_rental_daily",
    sector: "Transport",
    name: "Car Rental Daily",
    category: "Service / Transport",
    price: 2200,
    stock: 12,
    description: "Per-day car rental template for city and outstation travel.",
  },
  {
    key: "bike_rental_daily",
    sector: "Transport",
    name: "Bike Rental Daily",
    category: "Service / Transport",
    price: 700,
    stock: 20,
    description: "Bike rental booking template for short-distance use.",
  },
  {
    key: "travel_package_booking",
    sector: "Travel Agency",
    name: "Tour Package Booking",
    category: "Service / Travel",
    price: 6500,
    stock: 15,
    description: "Domestic tour package booking template.",
  },
  {
    key: "visa_assistance",
    sector: "Travel Agency",
    name: "Visa Assistance Service",
    category: "Service / Travel",
    price: 2500,
    stock: 25,
    description: "Visa documentation and assistance booking template.",
  },
  {
    key: "courier_pickup",
    sector: "Courier",
    name: "Courier Pickup Request",
    category: "Service / Courier",
    price: 150,
    stock: 120,
    description: "Local courier pickup and drop service template.",
  },
  {
    key: "cargo_transport",
    sector: "Logistics",
    name: "Mini Cargo Transport",
    category: "Service / Logistics",
    price: 1800,
    stock: 14,
    description: "Small goods transport booking template for local logistics.",
  },
  {
    key: "house_deep_clean",
    sector: "Cleaning",
    name: "Home Deep Cleaning",
    category: "Service / Cleaning",
    price: 2200,
    stock: 20,
    description: "One-time full home deep cleaning appointment template.",
  },
  {
    key: "office_cleaning",
    sector: "Cleaning",
    name: "Office Cleaning Service",
    category: "Service / Cleaning",
    price: 3500,
    stock: 12,
    description: "Office or showroom cleaning contract booking template.",
  },
  {
    key: "pest_control_visit",
    sector: "Cleaning",
    name: "Pest Control Visit",
    category: "Service / Cleaning",
    price: 1800,
    stock: 15,
    description: "Residential and commercial pest control service booking.",
  },
  {
    key: "security_guard_shift",
    sector: "Security",
    name: "Security Guard Shift",
    category: "Service / Security",
    price: 900,
    stock: 40,
    description: "Per-shift security staff deployment booking template.",
  },
  {
    key: "property_site_visit",
    sector: "Real Estate",
    name: "Property Site Visit",
    category: "Service / Real Estate",
    price: 500,
    stock: 40,
    description: "Property viewing and site visit booking template.",
  },
  {
    key: "legal_consultation",
    sector: "Legal",
    name: "Legal Consultation",
    category: "Service / Legal",
    price: 1500,
    stock: 20,
    description: "Legal advisory consultation slot for individuals and SMEs.",
  },
  {
    key: "gst_filing_service",
    sector: "Accounting",
    name: "GST Filing Service",
    category: "Service / Accounting",
    price: 1200,
    stock: 30,
    description: "Monthly GST filing and compliance support template.",
  },
  {
    key: "itr_filing_service",
    sector: "Accounting",
    name: "ITR Filing Service",
    category: "Service / Accounting",
    price: 1800,
    stock: 25,
    description: "Income tax return filing service booking template.",
  },
  {
    key: "mobile_repair_job",
    sector: "Repair Center",
    name: "Mobile Repair Job",
    category: "Service / Repair",
    price: 900,
    stock: 30,
    description: "Smartphone repair and diagnostics service template.",
  },
  {
    key: "laptop_service_job",
    sector: "Repair Center",
    name: "Laptop Service Job",
    category: "Service / Repair",
    price: 1600,
    stock: 20,
    description: "Laptop software and hardware servicing appointment template.",
  },
  {
    key: "internet_installation",
    sector: "Internet Service",
    name: "Broadband Installation",
    category: "Service / Internet",
    price: 1100,
    stock: 22,
    description: "Broadband or fiber new connection installation template.",
  },
  {
    key: "printing_design_job",
    sector: "Printing",
    name: "Printing and Design Job",
    category: "Service / Printing",
    price: 1300,
    stock: 35,
    description: "Poster, flyer, and card printing with design support template.",
  },
  {
    key: "misc_local_service",
    sector: "Other Service",
    name: "General Local Service Booking",
    category: "Service / Local",
    price: 600,
    stock: 20,
    description: "Template for unorganized service businesses needing quick booking setup.",
  },
];

const SERVICE_INVOICE_OPTIONS = [
  { value: "detailed", label: "Detailed Invoice (Line-wise)" },
  { value: "summary_total", label: "Summary Invoice (Grand Total Only)" },
];

const PARTNER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const resolveListingType = (item) => {
  if (!item) return "product";
  const hint = [item?.listing_type, item?.item_kind, item?.kind, item?.type, item?.product_kind]
    .find((v) => typeof v === "string" && v.trim());
  if (String(hint || "").toLowerCase().includes("service")) return "service";
  if (item?.is_service === true || item?.service_booking_enabled === true) return "service";
  return "product";
};

const normalizeListingType = (value) => {
  return String(value || "").toLowerCase() === "service" ? "service" : "product";
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

export default function PartnerProductForm({ product, onSaved, disabled = false, disabledReason = "", defaultListingType = "product" }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, listing_type: normalizeListingType(defaultListingType) });
  const [busy, setBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const [serviceSectorFilter, setServiceSectorFilter] = useState("All");
  const fileRef = useRef(null);

  useEffect(() => {
    const fallbackType = normalizeListingType(defaultListingType);
    const source = product || { ...EMPTY, listing_type: fallbackType };
    const resolved = product ? resolveListingType(source) : fallbackType;
    setForm({ ...EMPTY, ...source, listing_type: resolved });
    setLocalPreviewUrl("");
  }, [product, defaultListingType]);

  const visibleServiceTemplates = SERVICE_TEMPLATES.filter((tpl) => serviceSectorFilter === "All" || tpl.sector === serviceSectorFilter);

  const applyServiceTemplate = (tpl) => {
    if (!tpl) return;
    setForm((prev) => ({
      ...prev,
      listing_type: "service",
      name: tpl.name,
      category: tpl.category,
      description: tpl.description,
      price: String(tpl.price),
      stock: String(tpl.stock),
      service_template_key: tpl.key,
      service_invoice_mode: prev.service_invoice_mode || "detailed",
    }));
    toast.success(`${tpl.sector} template applied`);
  };

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
      const embeddedDataUrl = await toDataUrl(file);
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
      const persistedImageUrl = embeddedDataUrl || imageUrl;

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
        image_url: persistedImageUrl,
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
    const isService = form.listing_type === "service";
    if (!isService && !String(form.image_url || "").trim()) {
      toast.error("Listing image required. Please upload image first.");
      return;
    }
    setBusy(true);
    try {
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
        service_invoice_mode: isService ? String(form.service_invoice_mode || "detailed").toLowerCase() : "detailed",
        service_template_key: isService ? String(form.service_template_key || "").trim() : "",
        unit_type: isService ? "piece" : String(form.unit_type || "piece").toLowerCase(),
      };

      let saved = null;
      if (product?.id) saved = await api.put(`/partner/products/${product.id}`, payload);
      else saved = await api.post("/partner/products", payload);

      toast.success(product?.id ? "Listing updated and live" : "Listing created and live");
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
          {product?.id ? <Pencil className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />} {product?.id ? "Edit Listing" : "Add Listing"}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg sm:max-w-2xl max-h-[88vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{product?.id ? "Edit Listing" : "New Listing"}</DialogTitle>
          <DialogDescription>
            {product?.id ? "Update partner listing details and optionally replace the image, which is saved as a PDF link." : "Create a new partner shop/service listing. Service listings can be saved without image upload."}
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
          {form.listing_type === "service" ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-3" data-testid="service-layout-intro">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">Service Setup</p>
                <h3 className="font-display font-bold text-emerald-950 text-base mt-1">Booking-ready service listing তৈরি করুন</h3>
                <p className="text-xs text-emerald-900/80 mt-1">টেমপ্লেট বেছে নিন, এরপর প্রয়োজন মতো name, price, slots আর description ঠিক করুন।</p>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>{form.listing_type === "service" ? "Service Category *" : "Category *"}</Label>
              <Input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1" data-testid="my-prod-cat" />
            </div>
            <div>
              <Label>{form.listing_type === "service" ? "Service Brochure / PDF Link" : "PDF Link"}</Label>
              <Input value={form.pdf_url || ""} onChange={(e) => setForm({ ...form, pdf_url: e.target.value })} className="mt-1" placeholder={form.listing_type === "service" ? "https://...pdf" : "https://...pdf"} data-testid="my-prod-pdf" />
            </div>
          </div>
          {form.listing_type === "service" ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-3" data-testid="service-template-block">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-emerald-950">Ready Service Templates</p>
                  <p className="text-[11px] text-emerald-900">Hotel, Homestay, Transport, Clinic, Restaurant, Salon সহ service-focused presets.</p>
                </div>
                <select
                  value={serviceSectorFilter}
                  onChange={(e) => setServiceSectorFilter(e.target.value)}
                  className="h-9 rounded-md border border-emerald-300 bg-white px-3 text-xs"
                >
                  {Array.from(new Set(["All", ...SERVICE_TEMPLATES.map((s) => s.sector)])).map((sector) => (
                    <option key={sector} value={sector}>{sector}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {visibleServiceTemplates.map((tpl) => (
                  <button
                    key={tpl.key}
                    type="button"
                    onClick={() => applyServiceTemplate(tpl)}
                    className={`text-left rounded-lg border p-2.5 transition ${form.service_template_key === tpl.key ? "border-emerald-700 bg-white" : "border-emerald-200 bg-white/80 hover:bg-white"}`}
                  >
                    <p className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">{tpl.sector}</p>
                    <p className="font-semibold text-emerald-950 text-sm mt-0.5">{tpl.name}</p>
                    <p className="text-[11px] text-slate-600 mt-0.5">₹{tpl.price} · Slots {tpl.stock}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div>
              <Label>{form.listing_type === "service" ? "Image Upload (Optional for Service)" : "Image Upload (Saved as PDF)"}</Label>
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
            <p className="text-[11px] text-muted-foreground mt-1">JPG/PNG/WebP/GIF/SVG, max 5MB. Product listing-এ image recommended; service listing-এ image optional.</p>
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
          {form.listing_type !== "service" ? (
            <div>
              <Label>Price Unit</Label>
              <select
                value={form.unit_type || "piece"}
                onChange={(e) => setForm({ ...form, unit_type: e.target.value })}
                className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                data-testid="my-prod-unit-type"
              >
                {UNIT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">Example: যদি "Per Kg" দেন, তাহলে price হবে প্রতি কেজির দাম।</p>
            </div>
          ) : null}
          {form.listing_type === "service" ? (
            <div>
              <Label>Service Invoice Style</Label>
              <select
                value={form.service_invoice_mode || "detailed"}
                onChange={(e) => setForm({ ...form, service_invoice_mode: e.target.value })}
                className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                data-testid="my-service-invoice-mode"
              >
                {SERVICE_INVOICE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">Unorganized service হলে Summary mode নিলে invoice-এ Grand Total ফোকাস থাকে।</p>
            </div>
          ) : null}
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
          <div>
            <Label>{form.listing_type === "service" ? "Service Description" : "Description"}</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1" data-testid="my-prod-desc" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy} className="bg-emerald-900 hover:bg-emerald-950 text-white" data-testid="my-prod-save">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (product?.id ? (form.listing_type === "service" ? "Update Service" : "Update Product") : (form.listing_type === "service" ? "Save Service" : "Save Product"))}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


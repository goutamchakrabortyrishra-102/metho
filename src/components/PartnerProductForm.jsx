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
  youtube_url: "",
  listing_type: "product",
  unit_type: "piece",
  service_invoice_mode: "detailed",
  service_template_key: "",
};
const TRANSPORT_CARD_PREVIEW = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 520'><defs><linearGradient id='bg' x1='0' y1='0' x2='1' y2='1'><stop offset='0%25' stop-color='%230b1220'/><stop offset='100%25' stop-color='%231e293b'/></linearGradient><linearGradient id='road' x1='0' y1='0' x2='0' y2='1'><stop offset='0%25' stop-color='%23334155'/><stop offset='100%25' stop-color='%230f172a'/></linearGradient></defs><rect width='800' height='520' fill='url(%23bg)'/><rect y='330' width='800' height='190' fill='url(%23road)'/><path d='M90 335 C185 255 303 205 446 205 H560 C624 205 684 246 711 302 L740 362 H640 L608 312 C593 289 568 274 540 274 H438 C353 274 270 301 201 352 L178 369 H62 Z' fill='%23dc2626'/><path d='M254 223 H537 C589 223 634 251 659 293 L675 320 H611 L584 282 C569 260 545 246 519 246 H338 C304 246 270 253 238 267 Z' fill='%23fca5a5' opacity='0.18'/><circle cx='243' cy='368' r='44' fill='%230f172a'/><circle cx='243' cy='368' r='19' fill='%23e2e8f0'/><circle cx='592' cy='368' r='44' fill='%230f172a'/><circle cx='592' cy='368' r='19' fill='%23e2e8f0'/><rect x='368' y='236' width='118' height='48' rx='12' fill='%23dbeafe' opacity='0.92'/><rect x='498' y='236' width='73' height='48' rx='12' fill='%23dbeafe' opacity='0.92'/><rect x='95' y='402' width='610' height='8' rx='4' fill='%23f8fafc' opacity='0.2'/><text x='62' y='82' fill='%23fecaca' font-size='28' font-family='Arial' font-weight='700'>Transport Card Preview</text><text x='62' y='120' fill='%23ffffff' font-size='44' font-family='Arial' font-weight='700'>Vehicle image + Book Now</text></svg>";

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
    name: "Standard Room Booking (/day)",
    category: "Service / Hotel",
    price: 1800,
    stock: 12,
    description: "Per-night room booking with check-in/check-out support. Ideal for small to mid-size hotels.",
  },
  {
    key: "hotel_deluxe_room",
    sector: "Hotel",
    name: "Deluxe Room Booking (/day)",
    category: "Service / Hotel",
    price: 3200,
    stock: 8,
    description: "Deluxe room with premium amenities. Use daily capacity as available room count.",
  },
  {
    key: "hotel_suite_room",
    sector: "Hotel",
    name: "Suite Room Booking (/day)",
    category: "Service / Hotel",
    price: 4800,
    stock: 5,
    description: "Suite room booking template for premium guests and family stays.",
  },
  {
    key: "homestay_daily_stay",
    sector: "Homestay",
    name: "Homestay Daily Stay (/day)",
    category: "Service / Homestay",
    price: 1400,
    stock: 6,
    description: "Homestay stay booking per day with basic guest support and check-in details.",
  },
  {
    key: "homestay_weekend_package",
    sector: "Homestay",
    name: "Homestay Weekend Package (/day)",
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
    name: "Restaurant Time Slot Booking",
    category: "Service / Restaurant",
    price: 500,
    stock: 25,
    service_invoice_mode: "summary_total",
    description: "Table reservation booking. Capacity can represent total bookable tables per slot.",
  },
  {
    key: "rental_house_monthly",
    sector: "Homestay",
    name: "Rental House Booking (/month)",
    category: "Service / Homestay",
    price: 12000,
    stock: 10,
    service_invoice_mode: "summary_total",
    description: "Monthly rental-house booking template for long-stay customers.",
  },
  {
    key: "flat_apartment_monthly",
    sector: "Homestay",
    name: "Flat / Apartment Booking (/month)",
    category: "Service / Homestay",
    price: 18000,
    stock: 10,
    service_invoice_mode: "summary_total",
    description: "Monthly flat or apartment booking template for residential stays.",
  },
  {
    key: "shop_rent_monthly",
    sector: "Homestay",
    name: "Shop Rent Listing (/month)",
    category: "Service / Rent",
    price: 22000,
    stock: 6,
    service_invoice_mode: "summary_total",
    description: "Commercial shop monthly rent listing for tenancy-based booking inquiries.",
  },
  {
    key: "apartment_rent_monthly",
    sector: "Homestay",
    name: "Apartment Rent Listing (/month)",
    category: "Service / Rent",
    price: 26000,
    stock: 10,
    service_invoice_mode: "summary_total",
    description: "Apartment monthly rent listing with tenant shortlist and visit scheduling.",
  },
  {
    key: "anusthan_bari_booking",
    sector: "Restaurant",
    name: "Event Venue Booking",
    category: "Service / Event Venue",
    price: 9000,
    stock: 3,
    service_invoice_mode: "summary_total",
    description: "Date-based event venue booking template for ceremony and function halls.",
  },
  {
    key: "resort_vacation_booking",
    sector: "Hotel",
    name: "Resort Vacation Booking",
    category: "Service / Resort",
    price: 6500,
    stock: 8,
    service_invoice_mode: "summary_total",
    description: "Resort stay package listing with check-in slot booking support.",
  },
  {
    key: "wedding_hall_booking",
    sector: "Restaurant",
    name: "Wedding Hall Booking",
    category: "Service / Event Venue",
    price: 18000,
    stock: 2,
    service_invoice_mode: "summary_total",
    description: "Wedding/community hall reservation template for date-wise event booking.",
  },
  {
    key: "event_hall_booking",
    sector: "Restaurant",
    name: "Event Hall Booking",
    category: "Service / Event Venue",
    price: 12000,
    stock: 3,
    service_invoice_mode: "summary_total",
    description: "Event hall rental template for seminar, party, and social programs.",
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
    sector: "Delivery Partner",
    name: "Courier Pickup Request",
    category: "Service / Delivery Partner",
    price: 150,
    stock: 120,
    description: "Local courier pickup and drop service template.",
  },
  {
    key: "cargo_transport",
    sector: "Delivery Partner",
    name: "Mini Cargo Transport",
    category: "Service / Delivery Partner",
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
    sector: "Property Buy & Sell",
    name: "Property Site Visit",
    category: "Service / Property",
    price: 500,
    stock: 40,
    description: "Property viewing and site visit booking template.",
  },
  {
    key: "property_sale_listing",
    sector: "Property Buy & Sell",
    name: "Property Sale Listing",
    category: "Service / Property",
    price: 1500,
    stock: 50,
    service_invoice_mode: "summary_total",
    description: "Primary property sale listing service for owner/developer sell requests.",
  },
  {
    key: "property_resale_listing",
    sector: "Property Buy & Sell",
    name: "Property Resale Listing",
    category: "Service / Property",
    price: 1300,
    stock: 50,
    service_invoice_mode: "summary_total",
    description: "Resale property listing template for pre-owned flat/house sell support.",
  },
  {
    key: "plot_sale_listing",
    sector: "Property Buy & Sell",
    name: "Plot / Land Sale Listing",
    category: "Service / Property",
    price: 1700,
    stock: 45,
    service_invoice_mode: "summary_total",
    description: "Plot or land sale listing template with inquiry and visit scheduling.",
  },
  {
    key: "commercial_shop_sale",
    sector: "Property Buy & Sell",
    name: "Commercial Shop Sale",
    category: "Service / Property",
    price: 2200,
    stock: 35,
    service_invoice_mode: "summary_total",
    description: "Commercial shop/office sale support template for business properties.",
  },
  {
    key: "property_broker_service",
    sector: "Property Buy & Sell",
    name: "Property Broker Assistance",
    category: "Service / Property",
    price: 1200,
    stock: 60,
    description: "Brokerage assistance listing for buyer-seller matching and document help.",
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

export default function PartnerProductForm({
  product,
  onSaved,
  disabled = false,
  disabledReason = "",
  defaultListingType = "product",
  fixedListingType = "",
  allowedServiceSectors = null,
  excludedServiceSectors = null,
  initialServiceSectorFilter = "All",
  triggerLabel = "",
  dialogTitle = "",
  dialogDescription = "",
}) {
  const [open, setOpen] = useState(false);
  const forcedListingType = normalizeListingType(fixedListingType || "");
  const hasFixedListingType = fixedListingType === "product" || fixedListingType === "service";
  const [form, setForm] = useState({
    ...EMPTY,
    listing_type: hasFixedListingType ? forcedListingType : normalizeListingType(defaultListingType),
  });
  const [busy, setBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const [serviceSectorFilter, setServiceSectorFilter] = useState(initialServiceSectorFilter);
  const [customTemplateTypeName, setCustomTemplateTypeName] = useState("");
  const fileRef = useRef(null);
  const normalizedAllowedServiceSectors = Array.isArray(allowedServiceSectors) && allowedServiceSectors.length
    ? allowedServiceSectors.filter(Boolean)
    : null;
  const normalizedExcludedServiceSectors = Array.isArray(excludedServiceSectors) && excludedServiceSectors.length
    ? excludedServiceSectors.filter(Boolean)
    : null;
  const isTransportOnlyTemplateMode = Array.isArray(normalizedAllowedServiceSectors)
    && normalizedAllowedServiceSectors.length > 0
    && normalizedAllowedServiceSectors.every((sector) => ["Transport", "Logistics"].includes(sector))
    && normalizedAllowedServiceSectors.includes("Transport");
  const serviceTemplatePool = normalizedAllowedServiceSectors
    ? SERVICE_TEMPLATES.filter((tpl) => normalizedAllowedServiceSectors.includes(tpl.sector))
    : SERVICE_TEMPLATES.filter((tpl) => !normalizedExcludedServiceSectors?.includes(tpl.sector));
  const serviceSectorOptions = Array.from(new Set([
    ...(normalizedAllowedServiceSectors && normalizedAllowedServiceSectors.length > 1 ? ["All"] : []),
    ...serviceTemplatePool.map((tpl) => tpl.sector),
  ]));

  useEffect(() => {
    const fallbackType = normalizeListingType(defaultListingType);
    const source = product || { ...EMPTY, listing_type: fallbackType };
    const resolved = hasFixedListingType ? forcedListingType : (product ? resolveListingType(source) : fallbackType);
    const rawImageUrl = String(source?.image_url || "");
    // auto-clear preset SVG placeholder images so partner is prompted to upload a real one
    const cleanedImageUrl = rawImageUrl.startsWith("data:image/svg+xml") ? "" : rawImageUrl;
    setForm({ ...EMPTY, ...source, listing_type: resolved, image_url: cleanedImageUrl });
    setLocalPreviewUrl("");
  }, [product, defaultListingType, hasFixedListingType, forcedListingType]);

  useEffect(() => {
    const fallbackFilter = serviceSectorOptions[0] || "All";
    const preferred = serviceSectorOptions.includes(initialServiceSectorFilter)
      ? initialServiceSectorFilter
      : fallbackFilter;
    setServiceSectorFilter((prev) => {
      if (serviceSectorOptions.includes(prev)) return prev;
      return preferred;
    });
  }, [initialServiceSectorFilter, serviceSectorOptions]);

  const visibleServiceTemplates = serviceTemplatePool.filter((tpl) => serviceSectorFilter === "All" || tpl.sector === serviceSectorFilter);
  const activeListingType = hasFixedListingType ? forcedListingType : form.listing_type;

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
      service_invoice_mode: String(tpl.service_invoice_mode || prev.service_invoice_mode || "detailed").toLowerCase(),
    }));
    toast.success(`${tpl.sector} template applied`);
  };

  const applyCustomTemplateType = () => {
    const nextName = String(customTemplateTypeName || "").trim();
    if (!nextName) {
      toast.error("New template type name দিন");
      return;
    }
    const inferredSector = serviceSectorFilter && serviceSectorFilter !== "All"
      ? serviceSectorFilter
      : "Other Service";
    setForm((prev) => ({
      ...prev,
      listing_type: "service",
      name: nextName,
      category: String(prev.category || `Service / ${inferredSector}`),
      service_template_key: "",
      stock: String(prev.stock || "1"),
      service_invoice_mode: String(prev.service_invoice_mode || "detailed").toLowerCase(),
    }));
    toast.success("Custom service type applied. এখন fields edit করে save করুন");
  };

  const convertSelectedTemplateToCustom = () => {
    if (!String(form.service_template_key || "").trim()) {
      toast.error("আগে একটি template select করুন");
      return;
    }
    setForm((prev) => ({ ...prev, service_template_key: "" }));
    toast.success("Template editable custom mode-এ নেয়া হয়েছে");
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
      const preview = URL.createObjectURL(file);
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
      setLocalPreviewUrl(preview);

      let imageUpload = null;
      const imageEndpoints = ["/partner/upload/product-image", "/admin/upload/product-image"];
      for (const endpoint of imageEndpoints) {
        try {
          const imageFd = new FormData();
          imageFd.append("file", file);
          imageUpload = await api.post(endpoint, imageFd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          break;
        } catch (uploadErr) {
          const status = Number(uploadErr?.response?.status || 0);
          if (status !== 401 && status !== 403 && status !== 404) throw uploadErr;
        }
      }

      const pdfBlob = await imageToPdfBlob(file);
      const pdfFile = new File([pdfBlob], `${Date.now()}-catalog.pdf`, { type: "application/pdf" });

      let pdfUpload = null;
      const endpoints = ["/partner/upload/product-pdf", "/admin/upload/product-pdf"];
      for (const endpoint of endpoints) {
        try {
          const fd = new FormData();
          fd.append("file", pdfFile);
          pdfUpload = await api.post(endpoint, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          break;
        } catch (uploadErr) {
          const status = Number(uploadErr?.response?.status || 0);
          if (status !== 401 && status !== 403 && status !== 404) throw uploadErr;
        }
      }

      const imageData = imageUpload?.data || {};
      const pdfData = pdfUpload?.data || {};
      const imageUrl = resolveImageUrl(imageData?.image_url || imageData?.url || imageData?.file_url || imageData?.link || "");
      const pdfUrl = resolveImageUrl(pdfData?.pdf_url || pdfData?.url || pdfData?.file_url || pdfData?.link || "");
      setForm((prev) => ({
        ...prev,
        image_url: imageUrl || prev.image_url || "",
        pdf_url: pdfUrl || prev.pdf_url || "",
      }));
      if (imageUrl && pdfUrl) toast.success(isTransportOnlyTemplateMode ? "Image saved (PDF auto-generated)" : "Image and PDF saved");
      else if (imageUrl) toast.success("Image saved");
      else if (pdfUrl) toast.success("PDF link saved");
      else toast.success("Upload completed");
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Image/PDF upload failed.");
    } finally {
      setUploadingImage(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async (e) => {
    e.preventDefault();
    const listingType = hasFixedListingType ? forcedListingType : form.listing_type;
    const isService = listingType === "service";
    const isTransportOnly = isTransportOnlyTemplateMode;
    if (isTransportOnly && !String(form.image_url || "").trim()) {
      toast.error("Vehicle image upload করুন");
      return;
    }
    if (!isService && !String(form.image_url || "").trim() && !String(form.pdf_url || "").trim()) {
      toast.error("Listing PDF required. Please upload image to auto-generate PDF link first.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        ...form,
        name: isTransportOnly ? String(form.name || "").trim() || "book now" : String(form.name || "").trim(),
        category: isTransportOnly ? String(form.category || "").trim() || "General" : String(form.category || "").trim(),
        price: Number(isTransportOnly ? (form.price || 100) : form.price),
        stock: Number(form.stock || (isService ? 1 : 0)),
        discount_percent: Number(form.discount_percent || 0),
        gst_percent: Number(form.gst_percent || 0),
        image_url: String(form.image_url || "").trim(),
        pdf_url: String(form.pdf_url || "").trim(),
        youtube_url: "",
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
          {product?.id ? <Pencil className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />} {product?.id ? (triggerLabel || "Edit Listing") : (triggerLabel || "Add Listing")}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg sm:max-w-2xl max-h-[88vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{product?.id ? (dialogTitle || "Edit Listing") : (dialogTitle || "New Listing")}</DialogTitle>
          <DialogDescription>
            {product?.id ? (dialogDescription || "Update partner listing details and optionally replace the image, which is saved as a PDF link.") : (dialogDescription || "Create a new partner shop/service listing. Service listings can be saved without image upload.")}
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
              {hasFixedListingType ? (
                <div className="mt-1.5 h-10 rounded-md border border-emerald-700 bg-emerald-50 px-3 text-sm font-semibold text-emerald-900 flex items-center" data-testid="my-listing-type-fixed">
                  {forcedListingType === "service" ? "Service" : "Product"}
                </div>
              ) : (
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
              )}
            </div>
            <div>
              <Label>{activeListingType === "service" ? (isTransportOnlyTemplateMode ? "Service Name" : "Service Name *") : "Product Name *"}</Label>
              <Input required={!isTransportOnlyTemplateMode} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" data-testid="my-prod-name" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Category *</Label><Input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1" data-testid="my-prod-cat" /></div>
            {isTransportOnlyTemplateMode ? null : (
              <div><Label>PDF Link</Label><Input value={form.pdf_url || ""} onChange={(e) => setForm({ ...form, pdf_url: e.target.value })} className="mt-1" placeholder="https://...pdf" data-testid="my-prod-pdf" /></div>
            )}
          </div>
          {activeListingType === "service" && !isTransportOnlyTemplateMode ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-3" data-testid="service-template-block">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-emerald-950">Ready Service Templates</p>
                  <p className="text-[11px] text-emerald-900">Hotel room, homestay, clinic, restaurant table, salon সহ pre-built setup।</p>
                </div>
                <select
                  value={serviceSectorFilter}
                  onChange={(e) => setServiceSectorFilter(e.target.value)}
                  className="h-9 rounded-md border border-emerald-300 bg-white px-3 text-xs"
                >
                  {serviceSectorOptions.map((sector) => (
                    <option key={sector} value={sector}>{sector}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
                <Input
                  value={customTemplateTypeName}
                  onChange={(e) => setCustomTemplateTypeName(e.target.value)}
                  placeholder="New type name (e.g. Aquarium Cleaning Service)"
                  className="h-9 bg-white"
                  data-testid="service-template-new-type-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={applyCustomTemplateType}
                  className="h-9 rounded-full"
                  data-testid="service-template-apply-new-type"
                >
                  New Type Apply
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={convertSelectedTemplateToCustom}
                  className="h-9 rounded-full"
                  data-testid="service-template-edit-as-custom"
                >
                  Edit As New Type
                </Button>
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
                    <div className="mt-2 flex justify-end">
                      <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-900">
                        Use Template
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <Label>{isTransportOnlyTemplateMode ? "Vehicle Image" : (activeListingType === "service" ? "Image Upload (Optional for Service)" : "Image Upload (Saved as PDF)")}</Label>
            {isTransportOnlyTemplateMode ? (
              <p className="mt-1.5 text-[11px] text-emerald-900">
                Transport listing-এ শুধু vehicle image upload হবে। Public card-এ Book Now button দেখাবে।
              </p>
            ) : null}
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
                  <><Upload className="w-4 h-4 mr-2" /> {isTransportOnlyTemplateMode ? (product?.id ? "Change Image" : "Upload Image") : (product?.id ? "Change Image / PDF" : "Upload Image / PDF")}</>
                )}
              </Button>
              {localPreviewUrl || form.image_url || (!isTransportOnlyTemplateMode && form.pdf_url) ? (
                <div className="relative">
                  <img
                    src={localPreviewUrl || form.image_url || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%25' stop-color='%23eff6ff'/><stop offset='100%25' stop-color='%23ecfdf5'/></linearGradient></defs><rect width='400' height='400' rx='28' fill='url(%23g)'/><rect x='62' y='54' width='276' height='292' rx='26' fill='%23ffffff' stroke='%23cbd5e1' stroke-width='4'/><circle cx='142' cy='142' r='22' fill='%23f59e0b' opacity='0.95'/><path d='M95 292 L162 220 L213 262 L260 208 L305 292 Z' fill='%2394a3b8' opacity='0.35'/><path d='M95 292 H305' stroke='%2394a3b8' stroke-width='5' stroke-linecap='round'/><text x='200' y='330' text-anchor='middle' fill='%230f766e' font-size='20' font-family='Arial' font-weight='700'>Image Preview</text></svg>"}
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
            <p className="text-[11px] text-muted-foreground mt-1">{isTransportOnlyTemplateMode ? "JPG/PNG/WebP/GIF/SVG, max 5MB. Upload করলে image URL save হবে এবং PDF auto-generate হবে." : "JPG/PNG/WebP/GIF/SVG, max 5MB. Upload করলে gallery-র জন্য image URL আর catalog preview-র জন্য PDF link দুটোই save হবে."}</p>
            {!isTransportOnlyTemplateMode && form.pdf_url ? (
              <p className="text-[11px] text-emerald-700 mt-1 break-all">PDF: {form.pdf_url}</p>
            ) : null}
            {product?.id && !isTransportOnlyTemplateMode ? (
              <p className="text-[11px] text-emerald-700 mt-1">If you upload a new image, the gallery image and regenerated PDF link will both update.</p>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {isTransportOnlyTemplateMode ? null : (
              <div><Label>{activeListingType === "service" ? "Booking Price (₹) *" : "Price (₹) *"}</Label><Input type="number" required={activeListingType === "service" ? true : true} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="mt-1" data-testid="my-prod-price" /></div>
            )}
            <div><Label>{activeListingType === "service" ? "Daily Slot / Capacity" : "Stock"}</Label><Input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="mt-1" data-testid="my-prod-stock" /></div>
          </div>
          {isTransportOnlyTemplateMode ? (
            <p className="text-[11px] text-sky-700 -mt-2">Transport fare booking request এ partner confirm করার সময় set হবে।</p>
          ) : null}
          {activeListingType !== "service" ? (
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
          {activeListingType === "service" ? (
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
          <div><Label>{activeListingType === "service" ? "Service Description" : "Description"}</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1" data-testid="my-prod-desc" /></div>
          <DialogFooter className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <Button type="submit" disabled={busy} className="bg-emerald-900 hover:bg-emerald-950 text-white" data-testid="my-prod-save">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (product?.id ? (activeListingType === "service" ? "Update Service" : "Update Product") : (activeListingType === "service" ? "Save Service" : "Save Product"))}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


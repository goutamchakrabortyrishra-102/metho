const PRODUCT_SECTOR = "products";
const TRANSPORT_SECTOR = "transport";
const HOSPITALITY_SECTOR = "stay-dining";
const DOORSTEP_SECTOR = "doorstep";
const OTHER_SERVICE_SECTOR = "other-services";

const SERVICE_SECTORS = [
  TRANSPORT_SECTOR,
  HOSPITALITY_SECTOR,
  DOORSTEP_SECTOR,
  OTHER_SERVICE_SECTOR,
];

const toCount = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const normalizeBusinessType = (value) => String(value || "").trim().toLowerCase();

const includesAny = (text, keywords) => keywords.some((k) => text.includes(k));
const normalizeHintText = (parts) => parts.map((value) => normalizeBusinessType(value)).join(" ").trim();

const TRANSPORT_TEMPLATE_KEYS = ["cab_airport_drop", "car_rental_daily", "bike_rental_daily", "cargo_transport", "courier_pickup"];
const HOSPITALITY_TEMPLATE_KEYS = ["hotel_standard_room", "hotel_deluxe_room", "hotel_suite_room", "homestay_daily_stay", "homestay_weekend_package", "restaurant_table_booking", "banquet_slot", "restaurant_takeaway_slot", "cafe_table_reservation"];
const DOORSTEP_TEMPLATE_KEYS = ["ac_service_visit", "plumbing_repair", "electrician_visit", "appliance_repair", "laundry_kg_service", "dry_clean_service", "tailoring_stitching", "beauty_home_service", "courier_pickup", "house_deep_clean", "office_cleaning", "pest_control_visit"];

const TRANSPORT_HINTS = [
  "transport",
  "cab",
  "taxi",
  "car",
  "car service",
  "car rental",
  "bike rental",
  "bike",
  "motorbike",
  "scooter",
  "vehicle",
  "logistics",
  "courier",
  "travel",
  "travel agency",
  "tour",
  "cargo",
  "carrier",
  "goods carrier",
  "truck",
  "pickup van",
  "van rental",
  "ride",
  "auto",
  "auto rental",
  "auto rickshaw",
  "autorickshaw",
  "e-rickshaw",
  "erickshaw",
  "rickshaw",
];

const HOSPITALITY_HINTS = [
  "hotel",
  "homestay",
  "home stay",
  "guest house",
  "guesthouse",
  "lodge",
  "resort",
  "inn",
  "restaurant",
  "cafe",
  "banquet",
  "stay",
  "dining",
  "takeaway",
  "food",
  "meal",
  "lounge",
];
const DOORSTEP_HINTS = ["doorstep", "home service", "cleaning", "laundry", "plumbing", "electrician", "repair", "tailoring", "beauty", "courier", "pest control", "appliance", "ac service", "home repair", "dry clean"];
const PRODUCT_HINTS = [
  "shop",
  "store",
  "retail",
  "product",
  "mart",
  "super market",
  "supermarket",
  "grocery",
  "vegetable",
  "cosmetics",
  "pharmacy",
  "electronics",
  "hardware",
  "stationery",
  "fashion",
  "wholesale",
  "distributor",
  "seller",
];

export const isTransportServiceLike = (item) => {
  const key = normalizeBusinessType(item?.service_template_key);
  if (TRANSPORT_TEMPLATE_KEYS.includes(key)) return true;
  const haystack = normalizeHintText([item?.category, item?.name, item?.description]);
  return includesAny(haystack, TRANSPORT_HINTS);
};

export const isHospitalityServiceLike = (item) => {
  const key = normalizeBusinessType(item?.service_template_key);
  if (HOSPITALITY_TEMPLATE_KEYS.includes(key)) return true;
  const haystack = normalizeHintText([item?.category, item?.name, item?.description]);
  return includesAny(haystack, HOSPITALITY_HINTS);
};

export const isDoorstepServiceLike = (item) => {
  const key = normalizeBusinessType(item?.service_template_key);
  if (DOORSTEP_TEMPLATE_KEYS.includes(key)) return true;
  const haystack = normalizeHintText([item?.category, item?.name, item?.description]);
  return includesAny(haystack, DOORSTEP_HINTS);
};

export const inferPartnerPrimarySector = ({ businessType, businessName, counts }) => {
  const normalizedType = normalizeBusinessType(businessType);
  const normalizedName = normalizeBusinessType(businessName);
  const identity = `${normalizedType} ${normalizedName}`.trim();
  const productCount = toCount(counts?.products);
  const transportCount = toCount(counts?.transport);
  const hospitalityCount = toCount(counts?.hospitality);
  const doorstepCount = toCount(counts?.doorstep);
  const otherServiceCount = toCount(counts?.otherServices);

  const looksLikeTransport = includesAny(identity, TRANSPORT_HINTS);
  const looksLikeHospitality = includesAny(identity, HOSPITALITY_HINTS);
  const looksLikeDoorstep = includesAny(identity, DOORSTEP_HINTS);
  const looksLikeProduct = includesAny(identity, PRODUCT_HINTS);

  // Deterministic mapping for registration/business naming.
  if (looksLikeTransport) return TRANSPORT_SECTOR;
  if (looksLikeHospitality) return HOSPITALITY_SECTOR;
  if (looksLikeDoorstep) return DOORSTEP_SECTOR;
  if (looksLikeProduct) return PRODUCT_SECTOR;

  const looksLikeServicePartner =
    normalizedType.includes("service") ||
    looksLikeTransport ||
    looksLikeHospitality ||
    looksLikeDoorstep;

  if (looksLikeServicePartner) {
    if (looksLikeTransport && transportCount <= 0) return TRANSPORT_SECTOR;
    if (looksLikeHospitality && hospitalityCount <= 0) return HOSPITALITY_SECTOR;
    if (looksLikeDoorstep && doorstepCount <= 0) return DOORSTEP_SECTOR;

    const rankedServiceSectors = [
      { key: TRANSPORT_SECTOR, count: transportCount },
      { key: HOSPITALITY_SECTOR, count: hospitalityCount },
      { key: DOORSTEP_SECTOR, count: doorstepCount },
      { key: OTHER_SERVICE_SECTOR, count: otherServiceCount },
    ];
    const top = rankedServiceSectors.sort((a, b) => b.count - a.count)[0];
    if (top?.count > 0) return top.key;
    if (looksLikeTransport) return TRANSPORT_SECTOR;
    if (looksLikeHospitality) return HOSPITALITY_SECTOR;
    if (looksLikeDoorstep) return DOORSTEP_SECTOR;
    return OTHER_SERVICE_SECTOR;
  }

  if (productCount > 0) return PRODUCT_SECTOR;
  const serviceTotal = transportCount + hospitalityCount + doorstepCount + otherServiceCount;
  if (serviceTotal <= 0) return OTHER_SERVICE_SECTOR;

  const rankedFallback = [
    { key: TRANSPORT_SECTOR, count: transportCount },
    { key: HOSPITALITY_SECTOR, count: hospitalityCount },
    { key: DOORSTEP_SECTOR, count: doorstepCount },
    { key: OTHER_SERVICE_SECTOR, count: otherServiceCount },
  ].sort((a, b) => b.count - a.count);
  return rankedFallback[0]?.key || OTHER_SERVICE_SECTOR;
};

export const getPartnerVisibleSectors = (primarySector) => {
  if (primarySector === PRODUCT_SECTOR) {
    return [PRODUCT_SECTOR];
  }
  if (SERVICE_SECTORS.includes(primarySector)) {
    return [primarySector];
  }
  return [PRODUCT_SECTOR];
};

export const isServiceSector = (sector) => SERVICE_SECTORS.includes(sector);

export const PARTNER_SECTOR_KEYS = {
  PRODUCT_SECTOR,
  TRANSPORT_SECTOR,
  HOSPITALITY_SECTOR,
  DOORSTEP_SECTOR,
  OTHER_SERVICE_SECTOR,
};

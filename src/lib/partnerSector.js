const PRODUCT_SECTOR = "products";
const TRANSPORT_SECTOR = "transport";
const DELIVERY_PARTNER_SECTOR = "delivery-partner";
const HOSPITALITY_SECTOR = "stay-dining";
const PROPERTY_SECTOR = "property-buy-sell";
const DOORSTEP_SECTOR = "doorstep";
const OTHER_SERVICE_SECTOR = "other-services";

const SERVICE_SECTORS = [
  TRANSPORT_SECTOR,
  DELIVERY_PARTNER_SECTOR,
  HOSPITALITY_SECTOR,
  PROPERTY_SECTOR,
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

const TRANSPORT_TEMPLATE_KEYS = ["cab_airport_drop", "car_rental_daily", "bike_rental_daily"];
const DELIVERY_TEMPLATE_KEYS = ["cargo_transport", "courier_pickup"];
const HOSPITALITY_TEMPLATE_KEYS = [
  "hotel_standard_room",
  "hotel_deluxe_room",
  "hotel_suite_room",
  "homestay_daily_stay",
  "homestay_weekend_package",
  "restaurant_table_booking",
  "banquet_slot",
  "restaurant_takeaway_slot",
  "cafe_table_reservation",
  "rental_house_monthly",
  "flat_apartment_monthly",
  "shop_rent_monthly",
  "apartment_rent_monthly",
  "anusthan_bari_booking",
  "resort_vacation_booking",
  "wedding_hall_booking",
  "event_hall_booking",
];
const PROPERTY_TEMPLATE_KEYS = [
  "property_site_visit",
  "property_sale_listing",
  "property_resale_listing",
  "plot_sale_listing",
  "commercial_shop_sale",
  "property_broker_service",
];
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

const DELIVERY_HINTS = [
  "delivery",
  "courier",
  "logistics",
  "cargo",
  "parcel",
  "shipment",
  "dispatch",
  "pickup drop",
  "pickup and drop",
  "goods carrier",
  "carrier",
  "freight",
  "delivery partner",
  "delivery service",
  "mini cargo",
];

const HOSPITALITY_HINTS = [
  "hotel",
  "homestay",
  "home stay",
  "rental house",
  "flat",
  "apartment",
  "guest house",
  "guesthouse",
  "lodge",
  "resort",
  "inn",
  "restaurant",
  "resturent",
  "cafe",
  "banquet",
  "seat booking",
  "sitbooking",
  "stay",
  "dining",
  "takeaway",
  "food",
  "meal",
  "lounge",
  "house rent",
  "flat rent",
  "shop rent",
  "apartment rent",
  "anusthan bari",
  "event venue rental",
  "resort rental",
  "hall rental",
  "anusthanbari",
  "resort vara",
  "resort bhara",
  "hall vara",
  "hall bhara",
  "wedding hall",
  "community hall",
  "party hall",
  "event hall",
];
const PROPERTY_HINTS = [
  "property",
  "real estate",
  "realestate",
  "buy sell",
  "buy & sell",
  "sale deed",
  "plot sale",
  "flat sale",
  "house sale",
  "shop sale",
  "commercial property",
  "broker",
  "brokerage",
  "property dealer",
  "apartment sale",
  "villa sale",
  "site visit",
  "resale",
  "land",
  "jomi",
  "jami",
  "bari bikri",
  "flat bikri",
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

export const isDeliveryServiceLike = (item) => {
  const key = normalizeBusinessType(item?.service_template_key);
  if (DELIVERY_TEMPLATE_KEYS.includes(key)) return true;
  const haystack = normalizeHintText([item?.category, item?.name, item?.description]);
  return includesAny(haystack, DELIVERY_HINTS);
};

export const isHospitalityServiceLike = (item) => {
  const key = normalizeBusinessType(item?.service_template_key);
  if (HOSPITALITY_TEMPLATE_KEYS.includes(key)) return true;
  const haystack = normalizeHintText([item?.category, item?.name, item?.description]);
  return includesAny(haystack, HOSPITALITY_HINTS);
};

export const isPropertyServiceLike = (item) => {
  const key = normalizeBusinessType(item?.service_template_key);
  if (PROPERTY_TEMPLATE_KEYS.includes(key)) return true;
  const haystack = normalizeHintText([item?.category, item?.name, item?.description]);
  return includesAny(haystack, PROPERTY_HINTS);
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
  const deliveryCount = toCount(counts?.delivery);
  const hospitalityCount = toCount(counts?.hospitality);
  const propertyCount = toCount(counts?.property);
  const doorstepCount = toCount(counts?.doorstep);
  const otherServiceCount = toCount(counts?.otherServices);

  const looksLikeDelivery = includesAny(identity, DELIVERY_HINTS);
  const looksLikeTransport = includesAny(identity, TRANSPORT_HINTS);
  const looksLikeHospitality = includesAny(identity, HOSPITALITY_HINTS);
  const looksLikeProperty = includesAny(identity, PROPERTY_HINTS);
  const looksLikeDoorstep = includesAny(identity, DOORSTEP_HINTS);
  const looksLikeProduct = includesAny(identity, PRODUCT_HINTS);

  // Deterministic mapping for registration/business naming.
  if (looksLikeDelivery) return DELIVERY_PARTNER_SECTOR;
  if (looksLikeTransport) return TRANSPORT_SECTOR;
  if (looksLikeHospitality) return HOSPITALITY_SECTOR;
  if (looksLikeProperty) return PROPERTY_SECTOR;
  if (looksLikeDoorstep) return DOORSTEP_SECTOR;
  if (looksLikeProduct) return PRODUCT_SECTOR;

  const looksLikeServicePartner =
    normalizedType.includes("service") ||
    looksLikeDelivery ||
    looksLikeTransport ||
    looksLikeHospitality ||
    looksLikeProperty ||
    looksLikeDoorstep;

  if (looksLikeServicePartner) {
    if (looksLikeDelivery && deliveryCount <= 0) return DELIVERY_PARTNER_SECTOR;
    if (looksLikeTransport && transportCount <= 0) return TRANSPORT_SECTOR;
    if (looksLikeHospitality && hospitalityCount <= 0) return HOSPITALITY_SECTOR;
    if (looksLikeProperty && propertyCount <= 0) return PROPERTY_SECTOR;
    if (looksLikeDoorstep && doorstepCount <= 0) return DOORSTEP_SECTOR;

    const rankedServiceSectors = [
      { key: DELIVERY_PARTNER_SECTOR, count: deliveryCount },
      { key: TRANSPORT_SECTOR, count: transportCount },
      { key: HOSPITALITY_SECTOR, count: hospitalityCount },
      { key: PROPERTY_SECTOR, count: propertyCount },
      { key: DOORSTEP_SECTOR, count: doorstepCount },
      { key: OTHER_SERVICE_SECTOR, count: otherServiceCount },
    ];
    const top = rankedServiceSectors.sort((a, b) => b.count - a.count)[0];
    if (top?.count > 0) return top.key;
    if (looksLikeDelivery) return DELIVERY_PARTNER_SECTOR;
    if (looksLikeTransport) return TRANSPORT_SECTOR;
    if (looksLikeHospitality) return HOSPITALITY_SECTOR;
    if (looksLikeProperty) return PROPERTY_SECTOR;
    if (looksLikeDoorstep) return DOORSTEP_SECTOR;
    return OTHER_SERVICE_SECTOR;
  }

  if (productCount > 0) return PRODUCT_SECTOR;
  const serviceTotal = deliveryCount + transportCount + hospitalityCount + propertyCount + doorstepCount + otherServiceCount;
  if (serviceTotal <= 0) return OTHER_SERVICE_SECTOR;

  const rankedFallback = [
    { key: DELIVERY_PARTNER_SECTOR, count: deliveryCount },
    { key: TRANSPORT_SECTOR, count: transportCount },
    { key: HOSPITALITY_SECTOR, count: hospitalityCount },
    { key: PROPERTY_SECTOR, count: propertyCount },
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
  DELIVERY_PARTNER_SECTOR,
  HOSPITALITY_SECTOR,
  PROPERTY_SECTOR,
  DOORSTEP_SECTOR,
  OTHER_SERVICE_SECTOR,
};

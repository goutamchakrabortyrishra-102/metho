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

const TRANSPORT_HINTS = [
  "transport",
  "cab",
  "taxi",
  "car",
  "car service",
  "car rental",
  "bike rental",
  "bike",
  "vehicle",
  "logistics",
  "cargo",
  "ride",
  "auto",
];

const HOSPITALITY_HINTS = ["hotel", "homestay", "restaurant", "cafe", "banquet", "stay", "dining"];
const DOORSTEP_HINTS = ["doorstep", "home service", "cleaning", "laundry", "plumbing", "electrician", "repair"];

export const inferPartnerPrimarySector = ({ businessType, businessName, counts }) => {
  const normalizedType = normalizeBusinessType(businessType);
  const normalizedName = normalizeBusinessType(businessName);
  const identity = `${normalizedType} ${normalizedName}`.trim();
  const productCount = toCount(counts?.products);
  const transportCount = toCount(counts?.transport);
  const hospitalityCount = toCount(counts?.hospitality);
  const doorstepCount = toCount(counts?.doorstep);
  const otherServiceCount = toCount(counts?.otherServices);

  if (normalizedType.includes("shop")) {
    return PRODUCT_SECTOR;
  }

  const looksLikeTransport = includesAny(identity, TRANSPORT_HINTS);
  const looksLikeHospitality = includesAny(identity, HOSPITALITY_HINTS);
  const looksLikeDoorstep = includesAny(identity, DOORSTEP_HINTS);

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
  if (serviceTotal <= 0) return PRODUCT_SECTOR;

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

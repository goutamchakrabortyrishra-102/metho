// Isolated, additive JSON-LD schema helpers for SEO (Google Structured Data).
// Pure functions only — never touch DOM, state, routing, or existing page logic.
// All inputs are optional; missing/invalid data is safely omitted instead of throwing.

const safeString = (value) => {
  try {
    const str = String(value ?? "").trim();
    return str || undefined;
  } catch {
    return undefined;
  }
};

const safeUrl = (value) => {
  const str = safeString(value);
  if (!str) return undefined;
  try {
    // Accept absolute URLs only; relative/invalid values are dropped rather than breaking markup.
    // eslint-disable-next-line no-new
    new URL(str);
    return str;
  } catch {
    return undefined;
  }
};

const safeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const stripUndefined = (obj) => Object.fromEntries(
  Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== "")
);

/**
 * Build an Organization JSON-LD schema object from app settings.
 * @param {object} settings - values from SettingsContext (all optional).
 * @returns {object|null} schema.org Organization node, or null if not enough data.
 */
export function getOrganizationSchema(settings = {}) {
  try {
    const name = safeString(settings?.company_name || settings?.site_title) || "METHO AAY-UPAY";
    const url = safeUrl(settings?.site_url) || safeUrl("https://methoaayupay.com");
    const logo = safeUrl(settings?.site_logo_url_full) || safeUrl(settings?.social_share_image_url_full);
    const sameAs = [settings?.facebook_url, settings?.instagram_url, settings?.youtube_url, settings?.twitter_url]
      .map(safeUrl)
      .filter(Boolean);

    return stripUndefined({
      "@context": "https://schema.org",
      "@type": "Organization",
      name,
      url,
      logo,
      ...(sameAs.length ? { sameAs } : {}),
    });
  } catch {
    return null;
  }
}

/**
 * Build a Product JSON-LD schema object from a product record.
 * @param {object} product - product record (name/price/currency/image/etc, all optional).
 * @returns {object|null} schema.org Product node, or null if not enough data.
 */
export function getProductSchema(product = {}) {
  try {
    const name = safeString(product?.name);
    if (!name) return null;

    const image = safeUrl(product?.image_url) || safeUrl(product?.product_image_url) || safeUrl(product?.thumbnail_url);
    const price = safeNumber(product?.price);
    const description = safeString(product?.description);

    const offers = price !== undefined ? stripUndefined({
      "@type": "Offer",
      priceCurrency: "INR",
      price: String(price),
      availability: "https://schema.org/InStock",
    }) : undefined;

    return stripUndefined({
      "@context": "https://schema.org",
      "@type": "Product",
      name,
      image,
      description,
      ...(offers ? { offers } : {}),
    });
  } catch {
    return null;
  }
}

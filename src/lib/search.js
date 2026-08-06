const normalizeText = (value) => String(value || "")
  .toLowerCase()
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[^a-z0-9\u0900-\u097f]+/g, " ")
  .trim();

export const searchTokens = (query) => normalizeText(query)
  .split(/\s+/)
  .filter(Boolean);

export const searchHaystack = (...values) => normalizeText(values.filter(Boolean).join(" "));

export const matchesSearch = (values, query) => {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const haystack = searchHaystack(...values);
  return tokens.every((token) => haystack.includes(token));
};

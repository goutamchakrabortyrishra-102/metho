// Legacy rows saved before the real AI reply text was logged.
const LEGACY_PLACEHOLDER = /^AI status-aware reply dispatched\b/i;

export const displayWhatsAppText = (text) => (LEGACY_PLACEHOLDER.test(String(text || "").trim()) ? "System message" : text);

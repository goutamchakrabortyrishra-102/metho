// Legacy rows saved before the real AI reply text was logged.
const LEGACY_PLACEHOLDER = /^AI status-aware reply dispatched\b/i;

export const displayWhatsAppText = (text) => (LEGACY_PLACEHOLDER.test(String(text || "").trim()) ? "System message" : text);
export const displayWhatsAppMessage = (message = {}) => {
  if (!message.is_non_text) return displayWhatsAppText(message.text);
  const type = String(message.message_type || "").toLowerCase();
  const subtype = String(message.message_subtype || "").toLowerCase();
  if (type === "audio") return subtype === "voice" ? "🎤 Voice message" : "🎵 Audio message";
  if (type === "image") return "🖼 Image";
  if (type === "location") return "📍 Location shared";
  if (type === "sticker") return "🏷 Sticker";
  if (type === "contacts") return "👤 Contact card";
  if (type === "document") {
    const filename = String(message.text || "").match(/^\[document:\s*(.*?)\]$/i)?.[1];
    return filename ? `📄 Document: ${filename}` : "📄 Document";
  }
  if (type === "video") return "🎞 Video message";
  if (type === "interactive") return "↪️ Interactive flow reply";
  return `📎 ${type ? `${type[0].toUpperCase()}${type.slice(1)}` : "Non-text message"}`;
};

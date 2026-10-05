// Legacy rows saved before the real AI reply text was logged.
const LEGACY_PLACEHOLDER = /^AI status-aware reply dispatched\b/i;

export const displayWhatsAppText = (text) => {
  const value = String(text || "").trim();
  if (LEGACY_PLACEHOLDER.test(value)) return "System message";
  if (value === "[voice message]") return "🎤 Voice message";
  if (value === "[audio message]") return "🎵 Audio message";
  if (value === "[image]") return "🖼 Image";
  if (value === "[location shared]") return "📍 Location shared";
  if (value === "[sticker]") return "🏷 Sticker";
  if (value === "[contact card received]") return "👤 Contact card";
  if (value === "[document received]") return "📄 Document";
  if (value === "[video message]") return "🎞 Video message";
  if (value === "[interactive flow reply received]") return "↪️ Interactive flow reply";
  const filename = value.match(/^\[document:\s*(.*?)\]$/i)?.[1];
  if (filename) return `📄 Document: ${filename}`;
  return text;
};
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

import { displayWhatsAppMessage, displayWhatsAppText } from "./whatsappDisplay";

describe("displayWhatsAppText", () => {
  it("replaces legacy placeholder text with a neutral label", () => {
    expect(displayWhatsAppText("AI status-aware reply dispatched (member onboarding)")).toBe("System message");
    expect(displayWhatsAppText("AI status-aware reply dispatched (member activation pending)")).toBe("System message");
  });

  it("keeps real messages unchanged", () => {
    expect(displayWhatsAppText("Your account is active.")).toBe("Your account is active.");
    expect(displayWhatsAppText("")).toBe("");
  });

  it.each([
    ["[voice message]", "🎤 Voice message"],
    ["[image]", "🖼 Image"],
    ["[location shared]", "📍 Location shared"],
    ["[sticker]", "🏷 Sticker"],
    ["[document: form.pdf]", "📄 Document: form.pdf"],
    ["[interactive flow reply received]", "↪️ Interactive flow reply"],
  ])("renders the bubble placeholder %s as %s", (text, expected) => {
    expect(displayWhatsAppText(text)).toBe(expected);
  });
});

describe("displayWhatsAppMessage", () => {
  it.each([
    [{ is_non_text: true, message_type: "audio", message_subtype: "voice" }, "🎤 Voice message"],
    [{ is_non_text: true, message_type: "image", text: "[image]" }, "🖼 Image"],
    [{ is_non_text: true, message_type: "location", text: "[location shared]" }, "📍 Location shared"],
    [{ is_non_text: true, message_type: "sticker", text: "[sticker]" }, "🏷 Sticker"],
    [{ is_non_text: true, message_type: "document", text: "[document: form.pdf]" }, "📄 Document: form.pdf"],
    [{ is_non_text: true, message_type: "interactive", message_subtype: "nfm_reply" }, "↪️ Interactive flow reply"],
  ])("labels non-text messages without an empty bubble", (message, expected) => {
    expect(displayWhatsAppMessage(message)).toBe(expected);
  });

  it("preserves text captions", () => {
    expect(displayWhatsAppMessage({ is_non_text: false, message_type: "image", text: "Please check this" })).toBe("Please check this");
  });
});

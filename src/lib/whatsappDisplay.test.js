import { displayWhatsAppText } from "./whatsappDisplay";

describe("displayWhatsAppText", () => {
  it("replaces legacy placeholder text with a neutral label", () => {
    expect(displayWhatsAppText("AI status-aware reply dispatched (member onboarding)")).toBe("System message");
    expect(displayWhatsAppText("AI status-aware reply dispatched (member activation pending)")).toBe("System message");
  });

  it("keeps real messages unchanged", () => {
    expect(displayWhatsAppText("Your account is active.")).toBe("Your account is active.");
    expect(displayWhatsAppText("")).toBe("");
  });
});

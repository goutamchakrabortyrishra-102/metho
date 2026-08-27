import React from "react";
import { MessageCircle } from "lucide-react";
import { buildWhatsAppShareUrl } from "@/lib/utils";
import { useSettings } from "@/contexts/SettingsContext";

// Standalone "Direct WhatsApp Order/Inquiry" floating button.
// Fully isolated from the Meta Cloud API / WhatsApp Business settings and
// automation — this only opens a plain wa.me deep link in a new tab.
// Fail-safe: if no usable phone number is configured anywhere, it renders
// nothing instead of showing a broken/dead button.
export default function WhatsAppOrderButton({
  phone,
  message = "Hi METHO AAY-UPAY, I want to place an order / ask about a product.",
  className = "",
}) {
  let settings = null;
  try {
    // useSettings() may throw if used outside SettingsProvider; guard defensively.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    settings = useSettings()?.settings;
  } catch {
    settings = null;
  }

  const resolvedPhone = String(
    phone ||
    settings?.support_whatsapp_number ||
    settings?.company_whatsapp_number ||
    settings?.contact_phone ||
    ""
  ).replace(/\D/g, "");

  if (!resolvedPhone) return null;

  let href = "";
  try {
    href = buildWhatsAppShareUrl({ phone: resolvedPhone, text: message });
  } catch {
    return null;
  }

  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Order or inquire via WhatsApp"
      data-testid="whatsapp-order-button"
      className={`fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-[#25D366] hover:bg-[#20b858] text-white px-4 py-3 shadow-lg shadow-emerald-900/20 transition-transform hover:scale-105 ${className}`}
    >
      <MessageCircle className="w-5 h-5" />
      <span className="hidden sm:inline text-sm font-semibold">Order on WhatsApp</span>
    </a>
  );
}

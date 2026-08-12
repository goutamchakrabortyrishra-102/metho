import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { Copy, CheckCircle2, Share2, MessageCircle, Link2, QrCode } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { jsPDF } from "jspdf";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/services/api";
import { openWhatsAppShare } from "@/lib/utils";

const FALLBACK_TEMPLATE =
`🌟 I joined METHOO STORE!
Open this link to visit METHO as guest or join with my sponsor code 👇
{referral_link}
Sponsor code: {sponsor_code}`;

/**
 * ReferralCard — WhatsApp / clipboard invite widget powered by the member's code.
 * Uses Admin-editable message template (Settings → Referral Message) with
 * {sponsor_code} & {referral_link} variable substitution.
 */
export default function ReferralCard({ downlineCount }) {
  const { user } = useAuth();
  const [template, setTemplate] = useState(FALLBACK_TEMPLATE);
  const [signupBonus, setSignupBonus] = useState(0);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const memberCode = user?.member_code || "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const referralLink = `${origin}/?ref=${memberCode}`;

  useEffect(() => {
    api.get("/settings").then((r) => {
      if (r.data?.referral_message_template) setTemplate(r.data.referral_message_template);
      setSignupBonus(Number(r.data?.referral_signup_bonus) || 0);
    }).catch(() => {});
  }, []);

  const message = template
    .replaceAll("{sponsor_code}", memberCode)
    .replaceAll("{referral_link}", referralLink);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast.success("Referral link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed");
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(memberCode);
      toast.success(`Sponsor code copied: ${memberCode}`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const shareWhatsApp = () => {
    openWhatsAppShare({ text: message });
  };

  const shareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join METHOO STORE", text: message, url: referralLink });
      } catch {
        /* user cancelled */
      }
    } else {
      copyLink();
    }
  };

  const downloadInvitePdf = () => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 16;
    let y = 18;

    doc.setFillColor(5, 46, 41);
    doc.rect(0, 0, pageWidth, 44, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("METHOO STORE Invite Card", marginX, 18);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Share this invitation on WhatsApp, phone, or in person.", marginX, 26);
    doc.text("Referral invites update automatically from your live sponsor code.", marginX, 32);

    y = 56;
    doc.setTextColor(11, 61, 46);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Your Sponsor Code", marginX, y);
    y += 8;
    doc.setFontSize(22);
    doc.text(memberCode, marginX, y);

    y += 14;
    doc.setFontSize(14);
    doc.text("Referral Link", marginX, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.textWithLink(referralLink, marginX, y, { url: referralLink });

    y += 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Invite Message Preview", marginX, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const previewLines = doc.splitTextToSize(message, pageWidth - marginX * 2);
    doc.text(previewLines, marginX, y);

    y += previewLines.length * 5 + 10;
    doc.setFontSize(10);
    doc.setTextColor(75, 85, 99);
    doc.text(`Direct downlines: ${downlineCount ?? "—"}`, marginX, y);
    doc.text(`Generated for ${user?.name || "member"}`, marginX, y + 6);
    doc.save(`METHO-Invite-${memberCode || "member"}.pdf`);
    toast.success("Invite PDF downloaded");
  };

  if (!memberCode) return null;

  return (
    <div
      className="rounded-xl bg-gradient-to-br from-emerald-900 via-emerald-900 to-emerald-950 text-white p-6 relative overflow-hidden"
      data-testid="referral-card"
    >
      <div className="absolute inset-0 grain opacity-25" />
      <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-amber-400/10 blur-2xl" />

      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-bold">Grow Your Downline</p>
            <h3 className="font-display font-black text-2xl mt-1">Invite &amp; Earn Leader Reward™</h3>
            <p className="text-xs text-emerald-100/80 font-body mt-1 max-w-md">
              {signupBonus > 0 ? (
                <>For every successful referral signup, your wallet gets an instant <span className="font-bold text-amber-300">₹{signupBonus}</span> credit, plus Leader Pool rewards on their orders.</>
              ) : (
                <>When a referral joins, you automatically earn Leader Pool rewards on their orders.</>
              )}
            </p>
            {signupBonus > 0 && (
              <div className="mt-3 inline-flex items-center gap-2 bg-amber-400 text-emerald-950 px-3 py-1.5 rounded-full text-xs font-black shadow-lg">
                <span className="w-4 h-4 rounded-full bg-emerald-950 text-amber-400 flex items-center justify-center text-[9px]">₹</span>
                ₹{signupBonus} INSTANT SIGNUP BONUS
              </div>
            )}
          </div>
          <Share2 className="w-8 h-8 text-amber-400 shrink-0" />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
          <button
            onClick={copyCode}
            className="text-left rounded-xl bg-white/10 hover:bg-white/15 transition-colors px-4 py-3"
            data-testid="referral-copy-code"
          >
            <p className="text-[10px] uppercase text-amber-400 font-bold tracking-widest">Your Sponsor Code · tap to copy</p>
            <p className="font-mono text-lg font-bold mt-1 tracking-wide">{memberCode}</p>
          </button>
          <div className="hidden md:flex flex-col justify-between gap-2">
            <span className="text-[10px] uppercase tracking-widest text-amber-400/80 font-semibold">Direct downlines</span>
            <span className="font-display font-black text-3xl leading-none">{downlineCount ?? "—"}</span>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-white/5 border border-white/10 px-3 py-2 flex items-center gap-2 min-w-0">
          <Link2 className="w-3.5 h-3.5 text-emerald-200 shrink-0" />
          <p className="text-xs font-mono text-emerald-100/90 truncate flex-1">{referralLink}</p>
          <button onClick={copyLink} className="shrink-0 rounded-md hover:bg-white/10 p-1.5" data-testid="referral-copy-link" aria-label="Copy link">
            {copied ? <CheckCircle2 className="w-4 h-4 text-amber-300" /> : <Copy className="w-4 h-4 text-emerald-100" />}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={shareWhatsApp}
            className="bg-[#25D366] hover:bg-[#20b858] text-white rounded-full font-semibold shadow-lg shadow-emerald-950/40"
            data-testid="referral-whatsapp-button"
          >
            <MessageCircle className="w-4 h-4 mr-2" />
            Refer via WhatsApp
          </Button>
          <Button
            onClick={() => setQrOpen(true)}
            variant="outline"
            className="border-amber-400 bg-amber-400/10 text-amber-300 hover:bg-amber-400 hover:text-emerald-950 rounded-full font-semibold"
            data-testid="referral-qr-button"
          >
            <QrCode className="w-4 h-4 mr-2" />
            Show QR
          </Button>
          <Button
            onClick={shareNative}
            variant="outline"
            className="border-white/20 bg-white/5 text-white hover:bg-white/15 rounded-full"
            data-testid="referral-share-button"
          >
            <Share2 className="w-4 h-4 mr-2" />
            More apps
          </Button>
          <Button
            onClick={downloadInvitePdf}
            variant="outline"
            className="border-white/20 bg-white/5 text-white hover:bg-white/15 rounded-full font-semibold"
            data-testid="referral-pdf-button"
          >
            <QrCode className="w-4 h-4 mr-2" />
            Invite PDF
          </Button>
        </div>
      </div>

      {/* QR Code Dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center">Your Referral QR Code</DialogTitle>
            <DialogDescription className="text-center">
              Anyone who scans this QR will be taken to the registration page with your sponsor code auto-filled.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="bg-white p-4 rounded-2xl border-4 border-amber-400 shadow-xl" data-testid="referral-qr-canvas">
              <QRCodeCanvas
                value={referralLink}
                size={240}
                level="H"
                bgColor="#ffffff"
                fgColor="#052e29"
                includeMargin={false}
              />
            </div>
            <p className="text-xs font-mono text-slate-600 break-all text-center max-w-full px-4">{referralLink}</p>
            <p className="text-sm font-bold text-emerald-800">Sponsor Code: <span className="font-mono">{memberCode}</span></p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  const canvas = document.querySelector('[data-testid="referral-qr-canvas"] canvas');
                  if (!canvas) return;
                  const link = document.createElement("a");
                  link.download = `METHO-Referral-${memberCode}.png`;
                  link.href = canvas.toDataURL("image/png");
                  link.click();
                  toast.success("QR downloaded");
                }}
                className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full"
                data-testid="referral-qr-download"
              >
                Download PNG
              </Button>
              <Button size="sm" variant="outline" onClick={copyLink} className="rounded-full" data-testid="referral-qr-copy">
                <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy Link
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


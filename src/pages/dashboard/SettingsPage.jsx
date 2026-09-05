import React, { useEffect, useState, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Settings as SettingsIcon, Save, Sparkles, Users, PieChart, Award, QrCode, Upload, Loader2, MessageCircle, Gift, Image as ImageIcon, FileCheck2, Share2, Copy } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resolveAssetUrl, openWhatsAppShare } from "@/lib/utils";

const isAdmin = (u) => u && (u.role === "super_admin" || u.role === "company_admin");
const BRANDING_IMAGE_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const normalizeIdList = (value, maxItems) => {
  if (!Array.isArray(value)) return [];
  const unique = [];
  value.forEach((item) => {
    const id = String(item || "").trim();
    if (!id || unique.includes(id)) return;
    unique.push(id);
  });
  return unique.slice(0, maxItems);
};

const updateSlotList = (list, slotIndex, nextValue, maxItems) => {
  const base = Array.from({ length: maxItems }, (_, i) => String(list?.[i] || "").trim());
  const normalizedNext = String(nextValue || "").trim();
  if (normalizedNext) {
    for (let i = 0; i < base.length; i += 1) {
      if (base[i] === normalizedNext) base[i] = "";
    }
  }
  base[slotIndex] = normalizedNext;
  return base.filter(Boolean);
};

const DEFAULT_SERVICE_SECTORS = ["Transport", "Delivery Partner", "Stay & Dining", "Property Buy & Sell", "Doorstep", "Other Services"];
const DEFAULT_SHOP_SECTORS = ["Vegetables", "Grocery", "Cosmetics & Beauty", "Others"];

const DEFAULT_SERVICE_TEMPLATES_BY_SECTOR = {
  Transport: ["Cab", "Car Rental", "Bike Rental", "Travel Agency"],
  "Delivery Partner": ["Courier", "Logistics", "Cargo", "Parcel", "Express Delivery", "Pickup & Drop"],
  "Stay & Dining": ["Hotel", "Homestay", "Restaurant", "Cafe", "Banquet", "House Rent", "Flat Rent", "Shop Rent", "Apartment Rent", "Event Venue Rental", "Resort Rental", "Hall Rental"],
  "Property Buy & Sell": ["Property Sale", "Flat Sale", "House Sale", "Shop Sale", "Plot Sale", "Commercial Property", "Property Broker", "Site Visit"],
  Doorstep: ["Home Service", "Laundry", "Cleaning", "Tailoring", "Beauty at Home", "Repair Center"],
  "Other Services": ["Doctor Clinic", "Diagnostic Center", "Education", "Fitness", "Legal", "Accounting", "Photography", "Internet Service", "Other Service"],
};

const DEFAULT_SHOP_TEMPLATES_BY_SECTOR = {
  Vegetables: ["Fresh Vegetable", "Leafy Greens", "Seasonal Produce", "Root Vegetables"],
  Grocery: ["Kirana Essentials", "Rice & Dal", "Spices & Masala", "Oil & Pantry"],
  "Cosmetics & Beauty": ["Skincare", "Makeup", "Hair Care", "Personal Care"],
  Others: ["Household", "Stationery", "Fashion", "General Store"],
};

const sanitizeList = (items) => {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  items.forEach((item) => {
    const value = String(item || "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out;
};

const normalizeRegistrationOptions = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const normalizeMap = (mapValue) => {
    const out = {};
    const entries = mapValue && typeof mapValue === "object" ? Object.entries(mapValue) : [];
    entries.forEach(([sector, list]) => {
      const name = String(sector || "").trim();
      if (!name) return;
      const normalizedList = sanitizeList(list);
      if (normalizedList.length) out[name] = normalizedList;
    });
    return out;
  };
  return {
    service_sectors: sanitizeList(source.service_sectors),
    shop_sectors: sanitizeList(source.shop_sectors),
    service_templates_by_sector: normalizeMap(source.service_templates_by_sector),
    shop_templates_by_sector: normalizeMap(source.shop_templates_by_sector),
  };
};

const mergeUniqueInOrder = (...lists) => {
  const seen = new Set();
  const out = [];
  lists.forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((item) => {
      const value = String(item || "").trim();
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return;
      seen.add(key);
      out.push(value);
    });
  });
  return out;
};

function ReferralMessageSection({ form, setF, memberCode }) {
  const template = form.referral_message_template ?? "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const previewCode = memberCode || "MTH-DEMO";
  const previewLink = `${origin}/register?ref=${previewCode}`;
  const preview = template
    .replaceAll("{sponsor_code}", previewCode)
    .replaceAll("{referral_link}", previewLink);
  const chars = template.length;
  const bonus = form.referral_signup_bonus ?? 0;
  return (
    <div className="bg-white rounded-xl border border-border p-6" data-testid="referral-message-section">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
            <MessageCircle className="w-4.5 h-4.5 text-emerald-700" />
          </div>
          <div>
            <h3 className="font-display font-bold text-emerald-950">Referral Program</h3>
            <p className="text-xs text-muted-foreground font-body mt-0.5">
              WhatsApp invite message & instant signup bonus configure করুন। যখনই কোনো user referral link দিয়ে register করবে, sponsor-এর wallet-এ bonus auto-credit হবে।
            </p>
          </div>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-widest bg-amber-100 text-amber-800 px-2 py-1 rounded-full">{chars} chars</span>
      </div>

      {/* Signup Bonus Row */}
      <div className="mt-5 rounded-xl bg-gradient-to-r from-amber-50 to-emerald-50 border border-amber-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="signup-bonus" className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-amber-500 text-emerald-950 flex items-center justify-center font-black text-xs">₹</span>
              Instant Signup Bonus (per referral)
            </Label>
            <p className="text-[11px] text-muted-foreground font-body mt-1">
              Sponsor-এর wallet-এ প্রতিটি successful referral-এ auto-credit হবে। <span className="font-semibold text-emerald-800">0 দিলে disable</span> হয়ে যাবে।
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-display font-black text-2xl text-emerald-950">₹</span>
            <Input
              id="signup-bonus"
              type="number"
              min="0"
              step="10"
              value={bonus}
              onChange={(e) => setF("referral_signup_bonus")(parseFloat(e.target.value) || 0)}
              data-testid="settings-referral-bonus"
              className="w-32 h-12 text-center font-display font-black text-xl bg-white border-amber-300 focus:border-amber-500"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
          {[0, 25, 50, 100, 250, 500].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setF("referral_signup_bonus")(v)}
              className={
                "px-2.5 py-1 rounded-full font-mono border transition-colors " +
                (Number(bonus) === v
                  ? "bg-amber-500 text-emerald-950 border-amber-600 font-bold"
                  : "bg-white text-emerald-800 border-emerald-200 hover:bg-emerald-50")
              }
              data-testid={`bonus-preset-${v}`}
            >
              ₹{v}{v === 0 ? " (off)" : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Message + Preview */}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <Label className="flex items-center justify-between">
            <span>WhatsApp Message Template</span>
            <span className="text-[10px] text-muted-foreground font-normal">Supports variables ↓</span>
          </Label>
          <Textarea
            value={template}
            onChange={(e) => setF("referral_message_template")(e.target.value)}
            rows={10}
            data-testid="settings-referral-message"
            className="mt-1.5 font-mono text-xs leading-relaxed"
            placeholder="Type your invite copy — use {sponsor_code} and {referral_link}"
          />
          <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
            <button
              type="button"
              onClick={() => setF("referral_message_template")(template + "{sponsor_code}")}
              className="px-2 py-1 bg-emerald-50 text-emerald-800 rounded-full font-mono border border-emerald-200 hover:bg-emerald-100"
              data-testid="insert-sponsor-code"
            >+ {"{sponsor_code}"}</button>
            <button
              type="button"
              onClick={() => setF("referral_message_template")(template + "{referral_link}")}
              className="px-2 py-1 bg-emerald-50 text-emerald-800 rounded-full font-mono border border-emerald-200 hover:bg-emerald-100"
              data-testid="insert-referral-link"
            >+ {"{referral_link}"}</button>
          </div>
        </div>
        <div>
          <Label>Live Preview</Label>
          <div className="mt-1.5 h-full min-h-[240px] p-4 rounded-xl bg-[#e5ddd5] border border-border relative">
            <div className="max-w-full ml-auto bg-[#dcf8c6] rounded-xl rounded-tr-none p-3 shadow text-xs whitespace-pre-wrap break-words font-body text-emerald-950" data-testid="referral-preview">
              {preview || <span className="italic text-muted-foreground">Type a message to see WhatsApp preview...</span>}
            </div>
            <p className="text-[10px] text-emerald-950/50 mt-2 text-center font-body">↑ WhatsApp preview</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function UpiSection({ form, setF, readOnly, onPersist }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/admin/upload/upi-qr", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const nextUrl = String(data?.url || "").trim();
      setF("upi_qr_url")(nextUrl);
      if (onPersist) {
        await onPersist(nextUrl);
        toast.success("QR uploaded and saved.");
      } else {
        toast.success("QR uploaded. Save settings to activate.");
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="bg-white rounded-xl border border-border p-6" data-testid="upi-settings-section">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <QrCode className="w-4.5 h-4.5 text-amber-700" />
          </div>
          <div>
            <h3 className="font-display font-bold text-emerald-950">UPI Payment Details</h3>
            <p className="text-xs text-muted-foreground font-body mt-0.5">
              Customer এই UPI-এ payment করবে। Order approve করলে commission cycle trigger হবে।
            </p>
          </div>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-widest bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full">Manual</span>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900" data-testid="admin-upi-otp-safety-note">
          <p className="font-semibold">Public notice suggestion: "মেঠো কখনো OTP, UPI PIN, ATM PIN, CVV চায় না" এই বার্তাটি customer-facing payment screen-এ রাখুন।</p>
          <p className="mt-1">Suggested copy: "METHO never asks for OTP, UPI PIN, ATM PIN, or CVV."</p>
        </div>
        <div>
          <Label>UPI ID / VPA</Label>
          <Input
            value={form.upi_id ?? ""}
            onChange={(e) => setF("upi_id")(e.target.value)}
            placeholder="e.g. methopvtltd@paytm"
            data-testid="settings-upi-id"
            className="mt-1.5 h-11 font-mono"
          />
          <p className="text-[11px] text-muted-foreground mt-1">Customer এই VPA-এ pay করবে।</p>
        </div>
        <div>
          <Label>Payee Display Name</Label>
          <Input
            value={form.upi_payee_name ?? ""}
            onChange={(e) => setF("upi_payee_name")(e.target.value)}
            placeholder="e.g. METHOO STORE"
            data-testid="settings-upi-payee"
            className="mt-1.5 h-11"
          />
        </div>
        <div>
          <Label>METHO Bank Account Holder</Label>
          <Input
            value={form.metho_bank_account_holder ?? ""}
            onChange={(e) => setF("metho_bank_account_holder")(e.target.value)}
            placeholder="e.g. METHO Logistics Pvt Ltd"
            data-testid="settings-metho-bank-holder"
            className="mt-1.5 h-11"
          />
        </div>
        <div>
          <Label>METHO Bank Name</Label>
          <Input
            value={form.metho_bank_name ?? ""}
            onChange={(e) => setF("metho_bank_name")(e.target.value)}
            placeholder="e.g. HDFC Bank"
            data-testid="settings-metho-bank-name"
            className="mt-1.5 h-11"
          />
        </div>
        <div>
          <Label>METHO Bank Branch</Label>
          <Input
            value={form.metho_bank_branch ?? ""}
            onChange={(e) => setF("metho_bank_branch")(e.target.value)}
            placeholder="e.g. Kolkata Main"
            data-testid="settings-metho-bank-branch"
            className="mt-1.5 h-11"
          />
        </div>
        <div>
          <Label>METHO Bank Account Number</Label>
          <Input
            value={form.metho_bank_account_number ?? ""}
            onChange={(e) => setF("metho_bank_account_number")(e.target.value)}
            placeholder="e.g. 123456789012"
            data-testid="settings-metho-bank-account-number"
            className="mt-1.5 h-11 font-mono"
          />
        </div>
        <div>
          <Label>METHO Bank IFSC</Label>
          <Input
            value={form.metho_bank_ifsc ?? ""}
            onChange={(e) => setF("metho_bank_ifsc")(String(e.target.value || "").toUpperCase())}
            placeholder="e.g. HDFC0001234"
            data-testid="settings-metho-bank-ifsc"
            className="mt-1.5 h-11 font-mono uppercase"
          />
        </div>
        <div className="md:col-span-2">
          <Label>UPI QR Code (upload image)</Label>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {form.upi_qr_url ? (
              <img src={resolveAssetUrl(form.upi_qr_url)} alt="QR" className="h-24 w-24 object-contain rounded-lg border border-border p-1 bg-white" />
            ) : (
              <div className="h-24 w-24 rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400">
                <QrCode className="w-8 h-8" />
              </div>
            )}
            <div className="flex-1 space-y-2">
              <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={readOnly} data-testid="settings-upi-qr-file" />
              <Button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading || readOnly}
                className="bg-emerald-800 hover:bg-emerald-900 text-white rounded-full"
                data-testid="settings-upi-qr-upload"
              >
                {uploading ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Uploading...</> : <><Upload className="w-4 h-4 mr-1" /> {form.upi_qr_url ? "Change QR" : "Upload QR Image"}</>}
              </Button>
              {form.upi_qr_url && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    setF("upi_qr_url")("");
                    if (onPersist) {
                      setUploading(true);
                      try {
                        await onPersist("");
                        toast.success("QR removed and saved.");
                      } catch (err) {
                        toast.error(err?.response?.data?.detail || "Save failed");
                      } finally {
                        setUploading(false);
                      }
                    }
                  }}
                  disabled={readOnly}
                  className="rounded-full ml-2"
                  data-testid="settings-upi-qr-remove"
                >
                  Remove
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">
                Optional — QR না দিলেও UPI ID copy করেই customer pay করতে পারবেন। PNG/JPG supported.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InstallShareSection() {
  const installUrl = "https://play.google.com/store/apps/details?id=com.methoaayupay.app";

  const shareText = [
    "METHO AAY-UPAY app install করুন:",
    installUrl,
    "Android: Open in Chrome and tap Install Now.",
    "iPhone: Open in Safari, tap Share -> Add to Home Screen.",
  ].join("\n");

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      toast.success("Install share template copied");
    } catch {
      toast.error("Could not copy share template");
    }
  };

  const shareWhatsapp = () => {
    openWhatsAppShare({ text: shareText });
  };

  const shareNative = async () => {
    if (!navigator.share) {
      shareWhatsapp();
      return;
    }
    try {
      await navigator.share({
        title: "METHO AAY-UPAY Install",
        text: shareText,
        url: installUrl,
      });
    } catch {
      // User cancelled share sheet.
    }
  };

  return (
    <div className="bg-white rounded-xl border border-border p-6" data-testid="install-share-section">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display font-bold text-emerald-950">Install Link Share Template</h3>
          <p className="text-xs text-muted-foreground font-body mt-0.5">
            Admin dashboard থেকে ready message copy করে WhatsApp-এ share করতে পারবেন।
          </p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-widest bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full">Install</span>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-slate-50 p-3">
        <p className="text-[11px] uppercase tracking-wider text-emerald-800 font-semibold">Install URL</p>
        <p className="mt-1 font-mono text-xs text-slate-700 break-all" data-testid="settings-install-url">{installUrl}</p>
      </div>

      <Textarea
        value={shareText}
        readOnly
        rows={6}
        className="mt-3 font-mono text-xs"
        data-testid="settings-install-share-template"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={copyTemplate} className="rounded-full" data-testid="settings-install-share-copy">
          <Copy className="w-4 h-4 mr-2" /> Copy Template
        </Button>
        <Button type="button" onClick={shareWhatsapp} className="rounded-full bg-[#25D366] hover:bg-[#20b858] text-white" data-testid="settings-install-share-whatsapp">
          <MessageCircle className="w-4 h-4 mr-2" /> Share to WhatsApp
        </Button>
        <Button type="button" variant="outline" onClick={shareNative} className="rounded-full" data-testid="settings-install-share-native">
          <Share2 className="w-4 h-4 mr-2" /> Share
        </Button>
      </div>
    </div>
  );
}

function Section({ title, subtitle, icon: Icon, children, badge }) {
  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          {Icon ? (
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <Icon className="w-4.5 h-4.5 text-emerald-800" />
            </div>
          ) : null}
          <div>
            <h3 className="font-display font-bold text-emerald-950">{title}</h3>
            <p className="text-xs text-muted-foreground font-body mt-0.5">{subtitle}</p>
          </div>
        </div>
        {badge ? <span className="text-[10px] font-semibold uppercase tracking-widest bg-amber-100 text-amber-800 px-2 py-1 rounded-full">{badge}</span> : null}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({ label, testId, value, onChange, suffix, hint, type = "number", step = "0.01" }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="relative mt-1.5">
        <Input
          type={type}
          step={type === "number" ? step : undefined}
          value={value ?? ""}
          onChange={(e) => onChange(type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
          data-testid={testId}
          className="h-11 pr-12"
        />
        {suffix ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-semibold">{suffix}</span>
        ) : null}
      </div>
      {hint ? <p className="text-[11px] text-muted-foreground mt-1 font-body">{hint}</p> : null}
    </div>
  );
}

function BrandingImageUpload({ purpose, label, hint, value, onChange, onPersist, readOnly, testId, uploadEndpoint }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const readAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read image"));
      reader.readAsDataURL(file);
    });

  const canLoadImage = (src, timeoutMs = 6000) =>
    new Promise((resolve) => {
      const next = String(src || "").trim();
      if (!next) {
        resolve(false);
        return;
      }
      const img = new Image();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      const timer = window.setTimeout(() => finish(false), timeoutMs);
      img.onload = () => {
        window.clearTimeout(timer);
        finish(true);
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        finish(false);
      };
      img.src = next;
    });

  const upload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > BRANDING_IMAGE_MAX_UPLOAD_BYTES) {
      toast.error("Image too large for branding upload (max 2MB)");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const normalizedPurpose = String(purpose || "").trim().toLowerCase();
      const shouldPersistAsEmbeddedBranding = !uploadEndpoint && Boolean(normalizedPurpose);
      let nextUrl = "";
      if (shouldPersistAsEmbeddedBranding) {
        nextUrl = await readAsDataUrl(f);
      } else if (uploadEndpoint) {
        const makeFormData = () => {
          const fd = new FormData();
          fd.append("file", f);
          return fd;
        };
        let data;
        try {
          const res = await api.post(uploadEndpoint, makeFormData(), {
            headers: { "Content-Type": "multipart/form-data" },
          });
          data = res?.data;
        } catch (err) {
          // Production safety: if dedicated endpoint is not yet deployed, fallback to legacy generic endpoint.
          if (err?.response?.status === 404 && purpose) {
            const fallbackRes = await api.post(`/admin/upload/branding-image?purpose=${encodeURIComponent(purpose)}`, makeFormData(), {
              headers: { "Content-Type": "multipart/form-data" },
            });
            data = fallbackRes?.data;
          } else {
            throw err;
          }
        }
        nextUrl = String(data?.url || "").trim();
        if (!nextUrl) throw new Error("Upload response missing url");
        const resolved = resolveAssetUrl(nextUrl);
        const reachable = await canLoadImage(resolved);
        if (!reachable) {
          throw new Error("Uploaded image URL is not reachable");
        }
      } else {
        nextUrl = await readAsDataUrl(f);
      }
      onChange(nextUrl);
      if (onPersist) {
        await onPersist(nextUrl);
        toast.success(`${label} uploaded and saved.`);
      } else {
        toast.success(`${label} uploaded. Save settings to activate.`);
      }
    } catch (err) {
      try {
        const embedded = await readAsDataUrl(f);
        onChange(embedded);
        if (onPersist) {
          await onPersist(embedded);
          toast.success(`${label} saved locally for reliable display.`);
        } else {
          toast.success(`${label} saved locally. Save settings to activate.`);
        }
      } catch {
        toast.error(err?.response?.data?.detail || "Upload failed");
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-lg border border-border p-3 bg-slate-50/40">
      <p className="text-sm font-semibold text-emerald-950">{label}</p>
      {hint && <p className="text-[11px] text-muted-foreground mb-2 font-body">{hint}</p>}
      <div className="flex items-center gap-3">
        {value ? (
          <img src={resolveAssetUrl(value)} alt={label} className="h-16 w-24 object-contain rounded-md bg-white border border-border p-1" />
        ) : (
          <div className="h-16 w-24 rounded-md border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400">
            <ImageIcon className="w-6 h-6" />
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={upload} disabled={readOnly} data-testid={`${testId}-file`} />
        <Button
          type="button"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy || readOnly}
          className="bg-emerald-800 hover:bg-emerald-900 text-white rounded-full"
          data-testid={`${testId}-upload`}
        >
          {busy ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Uploading...</> : <><Upload className="w-3.5 h-3.5 mr-1" /> {value ? "Change" : "Upload"}</>}
        </Button>
        {value && !readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              onChange("");
              if (onPersist) {
                setBusy(true);
                try {
                  await onPersist("");
                  toast.success(`${label} removed and saved.`);
                } catch (err) {
                  toast.error(err?.response?.data?.detail || "Save failed");
                } finally {
                  setBusy(false);
                }
              }
            }}
            className="rounded-full"
            data-testid={`${testId}-remove`}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { refresh: refreshSettings } = useSettings();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [metaForm, setMetaForm] = useState(null);
  const [metaAssignees, setMetaAssignees] = useState([]);
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaMessage, setMetaMessage] = useState("");
  const [whatsappForm, setWhatsappForm] = useState(null);
  const [whatsappAssignees, setWhatsappAssignees] = useState([]);
  const [whatsappBusy, setWhatsappBusy] = useState(false);
  const [whatsappMessage, setWhatsappMessage] = useState("");
  const [whatsappReplyRecipient, setWhatsappReplyRecipient] = useState("");
  const [whatsappReplyText, setWhatsappReplyText] = useState("");
  const [voiceCallerForm, setVoiceCallerForm] = useState(null);
  const [voiceCallerBusy, setVoiceCallerBusy] = useState(false);
  const [voiceCallerMessage, setVoiceCallerMessage] = useState("");
  const [landingPartnerOptions, setLandingPartnerOptions] = useState([]);
  const [landingPartnerOptionsLoading, setLandingPartnerOptionsLoading] = useState(false);

  const dedupeImageFields = [
    "site_logo_url",
    "landing_hero_image_url",
    "landing_tourism_banner_image_url",
    "directory_hero_image_url",
    "product_placeholder_image_url",
    "social_share_image_url",
  ];

  useEffect(() => {
    setLoading(true);
    api.get("/settings").then((r) => setForm(r.data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isAdmin(user)) return undefined;
    Promise.all([api.get("/admin/settings/meta"), api.get("/admin/crm/assignees")])
      .then(([settingsResponse, assigneeResponse]) => {
        setMetaForm({
          ...settingsResponse.data,
          verify_token: "",
          app_secret: "",
          access_token: "",
        });
        setMetaAssignees(Array.isArray(assigneeResponse.data?.items) ? assigneeResponse.data.items : []);
      })
      .catch(() => setMetaForm(null));
    return undefined;
  }, [user]);

  useEffect(() => {
    if (!isAdmin(user)) return undefined;
    Promise.all([api.get("/admin/settings/whatsapp"), api.get("/admin/crm/assignees")])
      .then(([settingsResponse, assigneeResponse]) => {
        setWhatsappForm({
          ...settingsResponse.data,
          webhook_verify_token: "",
          app_secret: "",
          access_token: "",
        });
        setWhatsappAssignees(Array.isArray(assigneeResponse.data?.items) ? assigneeResponse.data.items : []);
      })
      .catch(() => setWhatsappForm(null));
    return undefined;
  }, [user]);

  useEffect(() => {
    if (!isAdmin(user)) return undefined;
    api.get("/admin/settings/voice-caller")
      .then(({ data }) => setVoiceCallerForm({ ...data, api_key: "", api_secret: "" }))
      .catch(() => setVoiceCallerForm(null));
    return undefined;
  }, [user]);

  useEffect(() => {
    let active = true;
    setLandingPartnerOptionsLoading(true);
    api.get("/directory/partners")
      .then((r) => {
        if (!active) return;
        const rows = Array.isArray(r?.data) ? r.data : [];
        const options = rows
          .map((item) => {
            const id = String(item?.id || item?.partner_code || "").trim();
            if (!id) return null;
            const code = String(item?.partner_code || "").trim();
            const name = String(item?.business_name || "").trim() || "Partner Shop";
            return {
              id,
              label: code ? `${name} (${code})` : name,
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.label.localeCompare(b.label));
        setLandingPartnerOptions(options);
      })
      .catch(() => {
        if (active) setLandingPartnerOptions([]);
      })
      .finally(() => {
        if (active) setLandingPartnerOptionsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const setF = (k) => (v) => setForm((prev) => ({ ...prev, [k]: v }));
  const setLandingFeaturedPartnerSlot = (slotIndex, nextValue) => {
    setForm((prev) => ({
      ...prev,
      landing_featured_partner_ids: updateSlotList(prev?.landing_featured_partner_ids, slotIndex, nextValue, 12),
    }));
  };

  const splitSum = form
    ? Number(form.commission_split_member_pool || 0) +
      Number(form.commission_split_leader_pool || 0) +
      Number(form.commission_split_mps_fund || 0) +
      Number(form.commission_split_company_fund || 0) +
      Number(form.commission_split_technology_reserve || 0)
    : 0;
  const splitValid = Math.abs(splitSum - 100) < 0.01;

  const registrationCustom = normalizeRegistrationOptions(form?.partner_registration_custom_options);
  const mergedServiceSectors = useMemo(
    () => mergeUniqueInOrder(DEFAULT_SERVICE_SECTORS, registrationCustom.service_sectors),
    [registrationCustom.service_sectors]
  );
  const mergedShopSectors = useMemo(
    () => mergeUniqueInOrder(DEFAULT_SHOP_SECTORS, registrationCustom.shop_sectors),
    [registrationCustom.shop_sectors]
  );
  const mergedServiceTemplates = useMemo(() => {
    const keys = mergeUniqueInOrder(Object.keys(DEFAULT_SERVICE_TEMPLATES_BY_SECTOR), Object.keys(registrationCustom.service_templates_by_sector), mergedServiceSectors);
    const out = {};
    keys.forEach((key) => {
      out[key] = mergeUniqueInOrder(DEFAULT_SERVICE_TEMPLATES_BY_SECTOR[key] || [], registrationCustom.service_templates_by_sector[key] || []);
    });
    return out;
  }, [registrationCustom.service_templates_by_sector, mergedServiceSectors]);
  const mergedShopTemplates = useMemo(() => {
    const keys = mergeUniqueInOrder(Object.keys(DEFAULT_SHOP_TEMPLATES_BY_SECTOR), Object.keys(registrationCustom.shop_templates_by_sector), mergedShopSectors);
    const out = {};
    keys.forEach((key) => {
      out[key] = mergeUniqueInOrder(DEFAULT_SHOP_TEMPLATES_BY_SECTOR[key] || [], registrationCustom.shop_templates_by_sector[key] || []);
    });
    return out;
  }, [registrationCustom.shop_templates_by_sector, mergedShopSectors]);

  const [newServiceSector, setNewServiceSector] = useState("");
  const [newShopSector, setNewShopSector] = useState("");
  const [newServiceSubBySector, setNewServiceSubBySector] = useState({});
  const [newShopSubBySector, setNewShopSubBySector] = useState({});

  const updateRegistrationCustom = (next) => {
    setForm((prev) => ({
      ...prev,
      partner_registration_custom_options: normalizeRegistrationOptions(next),
    }));
  };

  const addServiceSector = () => {
    const value = String(newServiceSector || "").trim();
    if (!value) return;
    updateRegistrationCustom({
      ...registrationCustom,
      service_sectors: mergeUniqueInOrder(registrationCustom.service_sectors, [value]),
    });
    setNewServiceSector("");
  };

  const removeServiceSector = (sector) => {
    const nextTemplates = { ...registrationCustom.service_templates_by_sector };
    delete nextTemplates[sector];
    updateRegistrationCustom({
      ...registrationCustom,
      service_sectors: registrationCustom.service_sectors.filter((item) => String(item).toLowerCase() !== String(sector).toLowerCase()),
      service_templates_by_sector: nextTemplates,
    });
  };

  const addShopSector = () => {
    const value = String(newShopSector || "").trim();
    if (!value) return;
    updateRegistrationCustom({
      ...registrationCustom,
      shop_sectors: mergeUniqueInOrder(registrationCustom.shop_sectors, [value]),
    });
    setNewShopSector("");
  };

  const removeShopSector = (sector) => {
    const nextTemplates = { ...registrationCustom.shop_templates_by_sector };
    delete nextTemplates[sector];
    updateRegistrationCustom({
      ...registrationCustom,
      shop_sectors: registrationCustom.shop_sectors.filter((item) => String(item).toLowerCase() !== String(sector).toLowerCase()),
      shop_templates_by_sector: nextTemplates,
    });
  };

  const addServiceSubCategory = (sector) => {
    const value = String(newServiceSubBySector[sector] || "").trim();
    if (!value) return;
    const nextList = mergeUniqueInOrder(registrationCustom.service_templates_by_sector?.[sector] || [], [value]);
    updateRegistrationCustom({
      ...registrationCustom,
      service_templates_by_sector: {
        ...registrationCustom.service_templates_by_sector,
        [sector]: nextList,
      },
    });
    setNewServiceSubBySector((prev) => ({ ...prev, [sector]: "" }));
  };

  const removeServiceSubCategory = (sector, value) => {
    const current = registrationCustom.service_templates_by_sector?.[sector] || [];
    const next = current.filter((item) => String(item).toLowerCase() !== String(value).toLowerCase());
    const map = { ...registrationCustom.service_templates_by_sector };
    if (next.length) map[sector] = next;
    else delete map[sector];
    updateRegistrationCustom({ ...registrationCustom, service_templates_by_sector: map });
  };

  const addShopSubCategory = (sector) => {
    const value = String(newShopSubBySector[sector] || "").trim();
    if (!value) return;
    const nextList = mergeUniqueInOrder(registrationCustom.shop_templates_by_sector?.[sector] || [], [value]);
    updateRegistrationCustom({
      ...registrationCustom,
      shop_templates_by_sector: {
        ...registrationCustom.shop_templates_by_sector,
        [sector]: nextList,
      },
    });
    setNewShopSubBySector((prev) => ({ ...prev, [sector]: "" }));
  };

  const removeShopSubCategory = (sector, value) => {
    const current = registrationCustom.shop_templates_by_sector?.[sector] || [];
    const next = current.filter((item) => String(item).toLowerCase() !== String(value).toLowerCase());
    const map = { ...registrationCustom.shop_templates_by_sector };
    if (next.length) map[sector] = next;
    else delete map[sector];
    updateRegistrationCustom({ ...registrationCustom, shop_templates_by_sector: map });
  };

  const buildSettingsPayload = (source) => ({
    smart_cycle_bonus_percent: Number(source.smart_cycle_bonus_percent),
    category_delivery_rules: source.category_delivery_rules && typeof source.category_delivery_rules === "object" ? source.category_delivery_rules : {},
    metho_commission_percent: Number(source.metho_commission_percent),
    franchise_reward_percent: Number(source.franchise_reward_percent) || 0,
    leader_match_percent: Number(source.leader_match_percent),
    smart_cycle_days: Number(source.smart_cycle_days),
    commission_split_member_pool: Number(source.commission_split_member_pool),
    commission_split_leader_pool: Number(source.commission_split_leader_pool),
    commission_split_mps_fund: Number(source.commission_split_mps_fund),
    commission_split_company_fund: Number(source.commission_split_company_fund),
    commission_split_technology_reserve: Number(source.commission_split_technology_reserve),
    min_withdrawal: Number(source.min_withdrawal),
    cycle_target_bv: Number(source.cycle_target_bv),
    cycle_reward_text: source.cycle_reward_text,
    rank_bronze_bv: Number(source.rank_bronze_bv),
    rank_silver_bv: Number(source.rank_silver_bv),
    rank_gold_bv: Number(source.rank_gold_bv),
    rank_diamond_bv: Number(source.rank_diamond_bv),
    company_name: source.company_name,
    mission_statement: source.mission_statement || "",
    vision_statement: source.vision_statement || "",
    rules_and_conditions: source.rules_and_conditions || "",
    return_policy: source.return_policy || "",
    partner_agreement_policy: source.partner_agreement_policy || "",
    company_gst_no: source.company_gst_no,
    company_pan: source.company_pan,
    invoice_terms: source.invoice_terms,
    currency_symbol: source.currency_symbol,
    upi_id: source.upi_id,
    upi_qr_url: source.upi_qr_url,
    upi_payee_name: source.upi_payee_name,
    manual_upi_enabled: !!source.manual_upi_enabled,
    razorpay_enabled: !!source.razorpay_enabled,
    razorpay_key_id: source.razorpay_key_id || "",
    razorpay_key_secret: source.razorpay_key_secret || "",
    customer_mobile_order_access_enabled: source.customer_mobile_order_access_enabled !== false,
    customer_mobile_access_mode: source.customer_mobile_access_mode || "mobile_only",
    customer_order_session_minutes: Number(source.customer_order_session_minutes) || 720,
    customer_order_otp_ttl_seconds: Number(source.customer_order_otp_ttl_seconds) || 300,
    customer_order_otp_length: Number(source.customer_order_otp_length) || 6,
    customer_order_otp_max_attempts: Number(source.customer_order_otp_max_attempts) || 5,
    customer_order_otp_debug_mode: !!source.customer_order_otp_debug_mode,
    customer_order_access_secret: source.customer_order_access_secret || "",
    referral_message_template: source.referral_message_template,
    referral_signup_bonus: Number(source.referral_signup_bonus) || 0,
    leader_min_direct_members: Number(source.leader_min_direct_members) || 0,
    leader_min_active_members: Number(source.leader_min_active_members) || 0,
    leader_min_personal_monthly_purchase: Number(source.leader_min_personal_monthly_purchase) || 0,
    leader_min_team_monthly_purchase: Number(source.leader_min_team_monthly_purchase) || 0,
    leader_min_active_days: Number(source.leader_min_active_days) || 0,
    leader_tier_leader_ranks: source.leader_tier_leader_ranks || "",
    leader_tier_elite_ranks: source.leader_tier_elite_ranks || "",
    leader_tier_crown_ranks: source.leader_tier_crown_ranks || "",
    mps_min_active_months: Number(source.mps_min_active_months) || 0,
    mps_min_monthly_purchase: Number(source.mps_min_monthly_purchase) || 0,
    mps_max_claim_amount: Number(source.mps_max_claim_amount) || 0,
    mps_min_claim_gap_days: Number(source.mps_min_claim_gap_days) || 0,
    mps_benefit_duration_months: Number(source.mps_benefit_duration_months) || 0,
    first_partner_order_cashback_percent: Number(source.first_partner_order_cashback_percent) || 0,
    first_partner_order_cashback_max: Number(source.first_partner_order_cashback_max) || 0,
    enable_partner_slab_pricing: !!source.enable_partner_slab_pricing,
    einvoice_enabled: !!source.einvoice_enabled,
    einvoice_provider: source.einvoice_provider || "mock",
    einvoice_sandbox: !!source.einvoice_sandbox,
    einvoice_api_url: source.einvoice_api_url || "",
    einvoice_api_key: source.einvoice_api_key || "",
    einvoice_client_id: source.einvoice_client_id || "",
    einvoice_client_secret: source.einvoice_client_secret || "",
    einvoice_gstin: source.einvoice_gstin || "",
    einvoice_username: source.einvoice_username || "",
    einvoice_password: source.einvoice_password || "",
    site_logo_url: source.site_logo_url || "",
    landing_hero_image_url: source.landing_hero_image_url || "",
    landing_tourism_banner_image_url: source.landing_tourism_banner_image_url || "",
    landing_metho_delivery_banner_image_url: source.landing_metho_delivery_banner_image_url || "",
    landing_tagline: source.landing_tagline || "",
    landing_subheading: source.landing_subheading || "",
    company_youtube_url: source.company_youtube_url || "",
    company_facebook_url: source.company_facebook_url || "",
    // Landing product/partner/store picks are managed from dedicated pages.
    // Do not overwrite those lists from Settings save to avoid stale page-state clobber.
    landing_featured_partner_ids: normalizeIdList(source.landing_featured_partner_ids, 12),
    landing_show_metho_store: source.landing_show_metho_store !== false,
    landing_show_partner_shop: source.landing_show_partner_shop !== false,
    product_placeholder_image_url: "",
    directory_hero_image_url: "",
    social_share_image_url: source.social_share_image_url || "",
    top_leader_1_name: source.top_leader_1_name || "",
    top_leader_1_title: source.top_leader_1_title || "",
    top_leader_1_image_url: source.top_leader_1_image_url || "",
    top_leader_2_name: source.top_leader_2_name || "",
    top_leader_2_title: source.top_leader_2_title || "",
    top_leader_2_image_url: source.top_leader_2_image_url || "",
    top_leader_3_name: source.top_leader_3_name || "",
    top_leader_3_title: source.top_leader_3_title || "",
    top_leader_3_image_url: source.top_leader_3_image_url || "",
    top_leader_4_name: source.top_leader_4_name || "",
    top_leader_4_title: source.top_leader_4_title || "",
    top_leader_4_image_url: source.top_leader_4_image_url || "",
    top_leader_5_name: source.top_leader_5_name || "",
    top_leader_5_title: source.top_leader_5_title || "",
    top_leader_5_image_url: source.top_leader_5_image_url || "",
    top_leader_6_name: source.top_leader_6_name || "",
    top_leader_6_title: source.top_leader_6_title || "",
    top_leader_6_image_url: source.top_leader_6_image_url || "",
    partner_registration_custom_options: normalizeRegistrationOptions(source.partner_registration_custom_options),
  });

  const persistFormToServer = async (source, successMessage) => {
    const payload = buildSettingsPayload(source);
    const { data } = await api.put("/settings", payload);
    setForm((prev) => ({ ...prev, ...(data || {}) }));
    await refreshSettings();
    if (successMessage) toast.success(successMessage);
  };

  const persistBrandingField = async (field, value) => {
    if (readOnly) return;
    const normalized = String(value || "").trim();
    if (normalized && form) {
      const duplicateOn = dedupeImageFields.find(
        (key) => key !== field && String(form[key] || "").trim() === normalized
      );
      if (duplicateOn) {
        toast.message("Same image is used in another branding section. Saving anyway.");
      }
    }
    // Persist only the changed branding field to avoid stale full-form overwrites.
    setForm((prev) => ({ ...prev, [field]: normalized }));
    const { data } = await api.put("/settings", { [field]: normalized });
    const nextServerValue = data && Object.prototype.hasOwnProperty.call(data, field) ? data[field] : undefined;
    setForm((prev) => {
      const merged = { ...prev, ...(data || {}) };
      // If server responds without the updated field value, keep the latest uploaded value.
      if ((nextServerValue === undefined || nextServerValue === null || nextServerValue === "") && normalized) {
        merged[field] = normalized;
      }
      return merged;
    });
    await refreshSettings();
  };

  const save = async (e) => {
    e.preventDefault();
    if (!isAdmin(user)) {
      toast.error("শুধু admin settings পরিবর্তন করতে পারবেন");
      return;
    }
    if (!splitValid) {
      toast.error(`Commission split এর যোগফল ১০০ হতে হবে (এখন ${splitSum})`);
      return;
    }
    setSaving(true);
    try {
      await persistFormToServer(form, "সব setting save হয়েছে। Engine live update হয়ে গেছে।");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const updateMetaField = (key) => (valueOrEvent) => {
    const value = valueOrEvent?.target && typeof valueOrEvent.target.value === "string"
      ? valueOrEvent.target.value
      : valueOrEvent;
    setMetaForm((prev) => ({ ...prev, [key]: value }));
  };
  const saveMeta = async () => {
    if (!metaForm || metaBusy) return;
    setMetaBusy(true);
    setMetaMessage("");
    try {
      const payload = {
        enabled: metaForm.enabled !== false,
        page_id: String(metaForm.page_id || "").trim(),
        app_id: String(metaForm.app_id || "").trim(),
        graph_api_version: String(metaForm.graph_api_version || "").trim(),
        default_assignee_id: String(metaForm.default_assignee_id || "").trim(),
      };
      ["verify_token", "app_secret", "access_token"].forEach((key) => {
        const value = typeof metaForm[key] === "string" ? metaForm[key].trim() : "";
        if (value) payload[key] = value;
      });
      const { data } = await api.put("/admin/settings/meta", payload);
      setMetaForm((prev) => ({ ...prev, ...data, verify_token: "", app_secret: "", access_token: "" }));
      setMetaMessage("Meta Lead Ads configuration saved.");
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      setMetaMessage(detail ? `Meta configuration could not be saved (${status || "error"}): ${detail}` : `Meta configuration could not be saved (${status || "network error"})`);
    } finally {
      setMetaBusy(false);
    }
  };
  const handleMetaSave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void saveMeta();
  };
  const testMeta = async () => {
    setMetaBusy(true);
    setMetaMessage("");
    try {
      const { data } = await api.post("/admin/settings/meta/test");
      if (data?.ok) {
        const pageNameDisplay = data?.page_name ? ` (${data.page_name})` : "";
        setMetaMessage(`Meta configuration verified! Page${pageNameDisplay} is accessible.`);
      } else if (data?.error) {
        setMetaMessage(`Meta API test failed: ${data.error}`);
      } else {
        setMetaMessage(`Missing: ${(data?.missing || []).join(", ")}`);
      }
    } catch (err) {
      setMetaMessage(err?.response?.data?.detail || "Meta configuration test failed");
    } finally {
      setMetaBusy(false);
    }
  };

  if (loading || !form) return <div className="text-muted-foreground">Loading settings...</div>;

  const readOnly = !isAdmin(user);
  const landingFeaturedPartnerIds = normalizeIdList(form?.landing_featured_partner_ids, 12);

  const updateWhatsappField = (key) => (valueOrEvent) => {
    const value = valueOrEvent?.target && typeof valueOrEvent.target.value === "string"
      ? valueOrEvent.target.value
      : valueOrEvent;
    setWhatsappForm((prev) => ({ ...prev, [key]: value }));
  };
  const updateVoiceCallerField = (key) => (valueOrEvent) => {
    try {
      const value = valueOrEvent?.target?.type === "checkbox"
        ? Boolean(valueOrEvent.target.checked)
        : valueOrEvent?.target
          ? String(valueOrEvent.target.value ?? "")
          : valueOrEvent;
      setVoiceCallerForm((previous) => ({ ...(previous || {}), [key]: value }));
    } catch (err) {
      toast.error("AI voice caller field could not be updated.");
    }
  };
  const saveVoiceCaller = async () => {
    if (!voiceCallerForm || voiceCallerBusy) return;
    setVoiceCallerBusy(true);
    setVoiceCallerMessage("");
    try {
      const payload = {};
      ["enabled", "provider", "caller_id", "bengali_voice", "hindi_voice", "english_voice", "model", "max_call_attempts", "retry_delay_minutes", "call_endpoint_url", "test_endpoint_url", "test_http_method", "auth_type", "auth_header_name", "agent_list_path", "agent_id_field", "agent_name_field"].forEach((key) => { payload[key] = voiceCallerForm[key]; });
      ["api_key", "api_secret"].forEach((key) => { if (String(voiceCallerForm[key] || "").trim()) payload[key] = String(voiceCallerForm[key]).trim(); });
      const response = await api.put("/admin/settings/voice-caller", payload);
      const data = response?.data;
      if (!data || typeof data !== "object" || data.success === false) throw new Error(data?.message || "Invalid AI voice caller response.");
      setVoiceCallerForm((previous) => ({ ...(previous || {}), ...data, api_key: "", api_secret: "" }));
      setVoiceCallerMessage(data.message || "AI voice caller configuration saved.");
    } catch (err) {
      const message = err?.response?.data?.message || err?.response?.data?.detail || err?.message || "AI voice caller configuration could not be saved.";
      setVoiceCallerMessage(message);
      toast.error(message);
    } finally { setVoiceCallerBusy(false); }
  };
  const testVoiceCaller = async () => {
    setVoiceCallerBusy(true);
    setVoiceCallerMessage("");
    try {
      const response = await api.post("/admin/settings/voice-caller/test");
      const data = response?.data;
      if (!data || typeof data !== "object") throw new Error("Invalid AI voice caller test response.");
      if (data.success === true || data.ok === true) {
        setVoiceCallerMessage(data.message || "AI voice caller configuration verified.");
      } else {
        const message = data.message || `Missing: ${(Array.isArray(data.missing) ? data.missing : []).join(", ") || "required configuration"}`;
        setVoiceCallerMessage(message);
        toast.error(message);
      }
    } catch (err) {
      const message = err?.response?.data?.message || err?.response?.data?.detail || err?.message || "AI voice caller configuration test failed.";
      setVoiceCallerMessage(message);
      toast.error(message);
    } finally { setVoiceCallerBusy(false); }
  };
  const saveWhatsapp = async () => {
    if (!whatsappForm || whatsappBusy) return;
    setWhatsappBusy(true);
    setWhatsappMessage("");
    try {
      const payload = {
        enabled: whatsappForm.enabled !== false,
        phone_number_id: String(whatsappForm.phone_number_id || "").trim(),
        business_account_id: String(whatsappForm.business_account_id || "").trim(),
        graph_api_version: String(whatsappForm.graph_api_version || "").trim(),
        default_assignee_id: String(whatsappForm.default_assignee_id || "").trim(),
      };
      ["default_auto_reply", "customer_auto_reply", "member_auto_reply", "partner_auto_reply", "invoice_template", "order_template", "registration_welcome_message", "registration_url", "registration_help_prompt", "registration_role_question", "member_registration_url", "member_registration_reply", "member_registration_keywords", "partner_registration_url", "partner_registration_reply", "partner_registration_keywords", "rider_registration_url", "rider_registration_reply", "rider_registration_keywords"].forEach((key) => {
        payload[key] = String(whatsappForm[key] || "").trim();
      });
      ["webhook_verify_token", "app_secret", "access_token"].forEach((key) => {
        const value = typeof whatsappForm[key] === "string" ? whatsappForm[key].trim() : "";
        if (value) payload[key] = value;
      });
      const { data } = await api.put("/admin/settings/whatsapp", payload);
      setWhatsappForm((prev) => ({ ...prev, ...data, webhook_verify_token: "", app_secret: "", access_token: "" }));
      setWhatsappMessage("WhatsApp Cloud API configuration saved.");
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      setWhatsappMessage(detail ? `WhatsApp configuration could not be saved (${status || "error"}): ${detail}` : `WhatsApp configuration could not be saved (${status || "network error"})`);
    } finally {
      setWhatsappBusy(false);
    }
  };
  const handleWhatsappSave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void saveWhatsapp();
  };
  const testWhatsapp = async () => {
    setWhatsappBusy(true);
    setWhatsappMessage("");
    try {
      const { data } = await api.post("/admin/settings/whatsapp/test");
      if (data?.ok) {
        const displayPhone = data?.display_phone_number ? ` (${data.display_phone_number})` : "";
        setWhatsappMessage(`WhatsApp Cloud API verified! Number${displayPhone} is accessible.`);
      } else if (data?.error) {
        setWhatsappMessage(`WhatsApp API test failed: ${data.error}`);
      } else {
        setWhatsappMessage(`Missing: ${(data?.missing || []).join(", ")}`);
      }
    } catch (err) {
      setWhatsappMessage(err?.response?.data?.detail || "WhatsApp configuration test failed");
    } finally {
      setWhatsappBusy(false);
    }
  };
  const sendWhatsappReply = async () => {
    if (!whatsappReplyRecipient.trim() || !whatsappReplyText.trim()) {
      setWhatsappMessage("Enter a recipient number and reply message.");
      return;
    }
    setWhatsappBusy(true);
    setWhatsappMessage("");
    try {
      const { data } = await api.post("/admin/settings/whatsapp/send", {
        recipient: whatsappReplyRecipient.trim(),
        message: whatsappReplyText.trim(),
      });
      if (!data?.ok) throw new Error(data?.error || "Reply could not be sent");
      setWhatsappReplyText("");
      setWhatsappMessage("WhatsApp reply sent through Meta Cloud API.");
    } catch (err) {
      setWhatsappMessage(err?.response?.data?.detail || err?.message || "WhatsApp reply failed");
    } finally {
      setWhatsappBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">System Settings</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Engine Configuration</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">
            নিচের যেকোনো number পরিবর্তন করুন — Smart Cycle, Leader Match, Commission Split সব live update হয়ে যাবে। কোনো code deploy লাগবে না।
          </p>
        </div>
        {readOnly ? (
          <span className="text-xs bg-amber-100 text-amber-800 font-semibold px-3 py-1 rounded-full">Read-only</span>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-3" data-testid="settings-layout-summary-cards">
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-800 font-semibold">Layout Mode</p>
          <p className="mt-1 text-sm text-emerald-950 font-semibold">Settings streamlined</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Landing featured picks এখন Products page থেকে manage হবে।</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-800 font-semibold">Quick Action</p>
          <p className="mt-1 text-sm text-emerald-950 font-semibold">Top Product Control</p>
          <Button
            type="button"
            variant="outline"
            className="mt-2 rounded-full"
            onClick={() => window.open("/app/products", "_blank")}
            data-testid="settings-open-products-page"
          >
            Open Products Page
          </Button>
        </div>
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-800 font-semibold">Quick Action</p>
          <p className="mt-1 text-sm text-emerald-950 font-semibold">Image Upload</p>
          <Button
            type="button"
            variant="outline"
            className="mt-2 rounded-full"
            onClick={() => window.open("/app/products?upload=1", "_blank")}
            data-testid="settings-open-product-upload"
          >
            Open Product Upload
          </Button>
        </div>
      </div>

      <form onSubmit={save} className="space-y-6">
        <fieldset disabled={readOnly} className="space-y-6">
          <Section
            title="Smart Cycle Engine™"
            subtitle="শুধু METHO product-এ চলে। Bonus Week-এ member qualified sales-এর উপর bonus পায়।"
            icon={Sparkles}
            badge="METHO Only"
          >
            <Field
              label="Smart Cycle Bonus %"
              testId="settings-smart-cycle-bonus"
              value={form.smart_cycle_bonus_percent}
              onChange={setF("smart_cycle_bonus_percent")}
              suffix="%"
              hint="Bonus Week-এ Member পায় Qualified METHO Sales-এর এই %।"
            />
            <Field
              label="Leader Match %"
              testId="settings-leader-match"
              value={form.leader_match_percent}
              onChange={setF("leader_match_percent")}
              suffix="%"
              hint="Sponsor পায় Direct Member-এর Smart Cycle Bonus-এর এই %। আলাদা payout।"
            />
            <Field
              label="Cycle Duration"
              testId="settings-cycle-days"
              value={form.smart_cycle_days}
              onChange={setF("smart_cycle_days")}
              suffix="days"
              step="1"
              hint="মোট cycle-এর দিন সংখ্যা (4 accumulation + Bonus Week = ২৮ দিন)।"
            />
          </Section>

          <Section
            title="METHO Commission ও Distribution Split"
            subtitle="METHO product sales-এর commission percentage admin set করবে। এরপর সেই commission ৫টি Fund-এ ভাগ হবে। যোগফল ১০০% হতে হবে।"
            icon={PieChart}
          >
            <Field
              label="METHOO STORE Product Commission %"
              testId="settings-metho-commission-percent"
              value={form.metho_commission_percent}
              onChange={setF("metho_commission_percent")}
              suffix="%"
              hint="METHO product sale-এর এই % commission pool হিসেবে ধরা হবে।"
            />
            <Field
              label="Franchise One-time Reward %"
              testId="settings-franchise-reward-percent"
              value={form.franchise_reward_percent}
              onChange={setF("franchise_reward_percent")}
              suffix="%"
              hint="Valid Franchise + Valid Member invoice paid হলে franchise এই one-time % পাবে।"
            />
            <div className="md:col-span-2">
              <div className={"rounded-lg border p-3 flex items-center justify-between " + (splitValid ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200")}>
                <span className="text-sm font-semibold text-emerald-950">Distribution মোট</span>
                <span className={"font-display font-black " + (splitValid ? "text-emerald-800" : "text-red-700")} data-testid="settings-split-total">
                  {splitSum.toFixed(2)}% {splitValid ? "✓" : "— ১০০ হতে হবে"}
                </span>
              </div>
            </div>
            <Field
              label="→ Member Reward Pool"
              testId="settings-split-member-pool"
              value={form.commission_split_member_pool}
              onChange={setF("commission_split_member_pool")}
              suffix="%"
              hint="Member Value Reward™ — Purchase করা member পায়।"
            />
            <Field
              label="→ Leader Reward Pool"
              testId="settings-split-leader-pool"
              value={form.commission_split_leader_pool}
              onChange={setF("commission_split_leader_pool")}
              suffix="%"
              hint="Elite Leader Reward™ — Sponsor পায়।"
            />
            <Field
              label="→ MPS Fund"
              testId="settings-split-mps-fund"
              value={form.commission_split_mps_fund}
              onChange={setF("commission_split_mps_fund")}
              suffix="%"
              hint="MPS Shield™ — Member-এর safety-net-এ জমা হয়।"
            />
            <Field
              label="→ Company Fund"
              testId="settings-split-company-fund"
              value={form.commission_split_company_fund}
              onChange={setF("commission_split_company_fund")}
              suffix="%"
              hint="Company operations, marketing ও settlement fund।"
            />
            <Field
              label="→ Technology Reserve"
              testId="settings-split-tech-reserve"
              value={form.commission_split_technology_reserve}
              onChange={setF("commission_split_technology_reserve")}
              suffix="%"
              hint="Platform maintenance ও future development-এর জন্য।"
            />
          </Section>

          <Section
            title="Category-wise Delivery Rules"
            subtitle="প্রতিটি category-এর delivery charge ও free-delivery limit আলাদা করে set করুন।"
            icon={SettingsIcon}
            badge="Admin-defined"
          >
            <div className="md:col-span-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
              <Label>Category Delivery Rules (JSON)</Label>
              <Textarea
                value={JSON.stringify(form.category_delivery_rules || {}, null, 2)}
                onChange={(e) => {
                  try {
                    const next = JSON.parse(e.target.value || "{}");
                    if (next && typeof next === "object" && !Array.isArray(next)) setF("category_delivery_rules")(next);
                  } catch { /* keep the last valid rule map while typing */ }
                }}
                rows={8}
                className="mt-1.5 bg-white font-mono text-xs"
                data-testid="settings-category-delivery-rules"
              />
              <p className="mt-2 text-[11px] text-sky-900">Example: {`{"Food Supply":{"delivery_charge":60,"free_delivery_threshold":500},"Grocery":{"delivery_charge":80,"free_delivery_threshold":2000}}`}</p>
              <p className="mt-1 text-[11px] text-slate-600">Product/partner listing-এ custom charge দিলে সেটি category rule-এর আগে কাজ করবে। Smart Cycle commission-এ delivery charge ধরা হবে না।</p>
            </div>
          </Section>

          <Section title="Wallet ও Withdrawal" subtitle="Member cash-out এর নিয়ম" icon={SettingsIcon}>
            <Field
              label="Minimum Withdrawal"
              testId="settings-min-withdrawal"
              value={form.min_withdrawal}
              onChange={setF("min_withdrawal")}
              suffix={form.currency_symbol || "₹"}
              hint="এর নিচে withdraw করা যাবে না।"
            />
            <Field
              label="Currency Symbol"
              testId="settings-currency"
              value={form.currency_symbol}
              onChange={setF("currency_symbol")}
              type="text"
              hint="Currency চিহ্ন (₹ / ₹ / $ ইত্যাদি)।"
            />
          </Section>

          <Section title="Team Business Cycle (Monthly)" subtitle="মাসিক team target ও reward" icon={Users}>
            <Field
              label="Monthly Team Target (Sales)"
              testId="settings-cycle-target"
              value={form.cycle_target_bv}
              onChange={setF("cycle_target_bv")}
              suffix={form.currency_symbol || "₹"}
              hint="Cycle পূরণ করার জন্য মাসিক team সেলস লক্ষ্যমাত্রা।"
            />
            <Field
              label="Reward Description"
              testId="settings-cycle-reward"
              value={form.cycle_reward_text}
              onChange={setF("cycle_reward_text")}
              type="text"
              hint="Business page-এ member রা এই text দেখবে।"
            />
          </Section>

          <Section title="Rank Thresholds" subtitle="প্রতিটি Rank-এর জন্য প্রয়োজনীয় Team Sales (₹)" icon={Award}>
            <Field label="Bronze Rank" testId="settings-rank-bronze" value={form.rank_bronze_bv} onChange={setF("rank_bronze_bv")} suffix={form.currency_symbol || "₹"} />
            <Field label="Silver Rank" testId="settings-rank-silver" value={form.rank_silver_bv} onChange={setF("rank_silver_bv")} suffix={form.currency_symbol || "₹"} />
            <Field label="Gold Rank" testId="settings-rank-gold" value={form.rank_gold_bv} onChange={setF("rank_gold_bv")} suffix={form.currency_symbol || "₹"} />
            <Field label="Diamond Rank" testId="settings-rank-diamond" value={form.rank_diamond_bv} onChange={setF("rank_diamond_bv")} suffix={form.currency_symbol || "₹"} />
          </Section>

          <Section
            title="Leader Eligibility Rules"
            subtitle="Monthly settlement-এ Leader Point Value পাওয়ার শর্ত। 0 দিলে সেই criterion disable হবে।"
            icon={Award}
            badge="Admin-defined"
          >
            <Field label="Min Direct Members" testId="settings-leader-direct" value={form.leader_min_direct_members} onChange={setF("leader_min_direct_members")} step="1" hint="সরাসরি sponsor করা active member সংখ্যা।" />
            <Field label="Min Active Members" testId="settings-leader-active" value={form.leader_min_active_members} onChange={setF("leader_min_active_members")} step="1" hint="Direct downlines যারা এই মাসে purchase করেছে।" />
            <Field label="Min Personal Monthly Purchase" testId="settings-leader-personal" value={form.leader_min_personal_monthly_purchase} onChange={setF("leader_min_personal_monthly_purchase")} suffix={form.currency_symbol || "₹"} hint="নিজের এই মাসের কেনাকাটা।" />
            <Field label="Min Team Monthly Purchase" testId="settings-leader-team" value={form.leader_min_team_monthly_purchase} onChange={setF("leader_min_team_monthly_purchase")} suffix={form.currency_symbol || "₹"} hint="সমস্ত direct downlines-এর এই মাসের যোগফল।" />
            <Field label="Min Account Age" testId="settings-leader-days" value={form.leader_min_active_days} onChange={setF("leader_min_active_days")} suffix="days" step="1" hint="Account activation থেকে দিন সংখ্যা।" />
            <Field
              label="Leader Tier Ranks"
              testId="settings-tier-leader-ranks"
              value={form.leader_tier_leader_ranks ?? ""}
              onChange={setF("leader_tier_leader_ranks")}
              type="text"
              hint="Comma-separated rank names. Example: starter,bronze"
            />
            <Field
              label="Elite Tier Ranks"
              testId="settings-tier-elite-ranks"
              value={form.leader_tier_elite_ranks ?? ""}
              onChange={setF("leader_tier_elite_ranks")}
              type="text"
              hint="Comma-separated rank names. Example: silver,gold"
            />
            <Field
              label="Crown Tier Ranks"
              testId="settings-tier-crown-ranks"
              value={form.leader_tier_crown_ranks ?? ""}
              onChange={setF("leader_tier_crown_ranks")}
              type="text"
              hint="Comma-separated rank names. Example: diamond"
            />
          </Section>

          <Section
            title="MPS Shield Fund Rules"
            subtitle="MPS claim eligibility ও limit। Backend শুধু balance রাখে, সব rule এখান থেকে পড়ে।"
            icon={SettingsIcon}
            badge="Admin-defined"
          >
            <Field label="Min Active Months" testId="settings-mps-months" value={form.mps_min_active_months} onChange={setF("mps_min_active_months")} step="1" hint="MPS claim eligible হওয়ার জন্য কত মাস active থাকতে হবে।" />
            <Field label="Min Monthly Purchase" testId="settings-mps-purchase" value={form.mps_min_monthly_purchase} onChange={setF("mps_min_monthly_purchase")} suffix={form.currency_symbol || "₹"} hint="MPS eligible হওয়ার জন্য minimum monthly purchase।" />
            <Field label="Max Claim Amount" testId="settings-mps-max" value={form.mps_max_claim_amount} onChange={setF("mps_max_claim_amount")} suffix={form.currency_symbol || "₹"} hint="একটি claim-এ সর্বোচ্চ payout।" />
            <Field label="Min Claim Gap" testId="settings-mps-gap" value={form.mps_min_claim_gap_days} onChange={setF("mps_min_claim_gap_days")} suffix="days" step="1" hint="দুটি consecutive claim-এর মাঝে minimum gap।" />
            <Field label="Benefit Duration" testId="settings-mps-duration" value={form.mps_benefit_duration_months} onChange={setF("mps_benefit_duration_months")} suffix="months" step="1" hint="Benefit পর্যায়ের মেয়াদ।" />
          </Section>

          <Section title="Company Branding" subtitle="Company name, GST/PAN — invoice-এ প্রিন্ট হবে" icon={SettingsIcon}>
            <Field label="Company Name" testId="settings-company-name" value={form.company_name} onChange={setF("company_name")} type="text" />
            <Field label="Company GSTIN" testId="settings-company-gst" value={form.company_gst_no} onChange={setF("company_gst_no")} type="text" hint="Invoice header-এ প্রদর্শিত হবে।" />
            <Field label="Company PAN" testId="settings-company-pan" value={form.company_pan} onChange={setF("company_pan")} type="text" hint="Invoice header-এ প্রদর্শিত হবে।" />
            <Field
              label="Company YouTube Video URL"
              testId="settings-company-youtube-url"
              value={form.company_youtube_url ?? ""}
              onChange={setF("company_youtube_url")}
              type="text"
              hint="Landing footer-এ Watch Video button show করার জন্য valid YouTube link দিন।"
            />
            <Field
              label="Company Facebook URL"
              testId="settings-company-facebook-url"
              value={form.company_facebook_url ?? ""}
              onChange={setF("company_facebook_url")}
              type="text"
              hint="Landing footer-এ Facebook button show করার জন্য আপনার page/profile link দিন।"
            />
            <div className="md:col-span-2">
              <Label className="text-emerald-950 font-semibold">Invoice Terms & Conditions</Label>
              <p className="text-xs text-muted-foreground font-body mt-0.5">প্রতিটি invoice-এর footer-এ এই text আসবে। Line-by-line লিখুন।</p>
              <Textarea
                value={form.invoice_terms ?? ""}
                onChange={(e) => setF("invoice_terms")(e.target.value)}
                rows={6}
                data-testid="settings-invoice-terms"
                className="mt-2 font-mono text-xs"
                placeholder="1. Return policy..."
              />
            </div>
          </Section>

          <Section
            title="Mission, Vision & Policies"
            subtitle="METHO mission/vision, rules-conditions, return policy এবং partner agreement policy আলাদাভাবে editable।"
            icon={SettingsIcon}
            badge="Policy"
          >
            <div className="md:col-span-2">
              <Label>Mission Statement</Label>
              <Textarea
                value={form.mission_statement ?? ""}
                onChange={(e) => setF("mission_statement")(e.target.value)}
                rows={3}
                className="mt-1.5"
                data-testid="settings-mission-statement"
              />
            </div>
            <div className="md:col-span-2">
              <Label>Vision Statement</Label>
              <Textarea
                value={form.vision_statement ?? ""}
                onChange={(e) => setF("vision_statement")(e.target.value)}
                rows={3}
                className="mt-1.5"
                data-testid="settings-vision-statement"
              />
            </div>
            <div className="md:col-span-2">
              <Label>Rules & Conditions</Label>
              <Textarea
                value={form.rules_and_conditions ?? ""}
                onChange={(e) => setF("rules_and_conditions")(e.target.value)}
                rows={5}
                className="mt-1.5"
                data-testid="settings-rules-conditions"
              />
            </div>
            <div className="md:col-span-2">
              <Label>Return Policy</Label>
              <Textarea
                value={form.return_policy ?? ""}
                onChange={(e) => setF("return_policy")(e.target.value)}
                rows={5}
                className="mt-1.5"
                data-testid="settings-return-policy"
              />
            </div>
            <div className="md:col-span-2">
              <Label>Partner Agreement Policy</Label>
              <Textarea
                value={form.partner_agreement_policy ?? ""}
                onChange={(e) => setF("partner_agreement_policy")(e.target.value)}
                rows={4}
                className="mt-1.5"
                data-testid="settings-partner-agreement-policy"
              />
              <p className="text-[11px] text-muted-foreground mt-1">প্রতিটি partner-এর Agreement % আলাদাভাবে set হবে এবং সেই rate অনুযায়ী commission গণনা হবে।</p>
            </div>
          </Section>

          <UpiSection
            form={form}
            setF={setF}
            readOnly={readOnly}
            onPersist={(value) => persistBrandingField("upi_qr_url", value)}
          />


          {!readOnly && metaForm ? (
            <Section title="Meta Lead Ads" subtitle="Configure Facebook Lead Ads without editing source code or environment files." icon={SettingsIcon} badge="Admin">
              <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Secrets are stored securely and are never displayed in full.
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={metaForm.enabled !== false} onChange={(e) => setMetaForm({ ...metaForm, enabled: e.target.checked })} /> Enable Meta Lead Integration</label>
              <Field label="Facebook Page ID" testId="settings-meta-page-id" value={metaForm.page_id} onChange={updateMetaField("page_id")} type="text" />
              <Field label="Meta App ID" testId="settings-meta-app-id" value={metaForm.app_id} onChange={updateMetaField("app_id")} type="text" />
              <Field label="Graph API Version" testId="settings-meta-graph-version" value={metaForm.graph_api_version} onChange={updateMetaField("graph_api_version")} type="text" />
              <div><Label>Default CRM Assignee</Label><select value={metaForm.default_assignee_id || ""} onChange={(e) => setMetaForm({ ...metaForm, default_assignee_id: e.target.value })} className="mt-1.5 h-11 w-full rounded-md border border-input px-3"><option value="">First active admin</option>{metaAssignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              {[["verify_token", "Webhook Verify Token"], ["app_secret", "App Secret"], ["access_token", "Page Access Token"]].map(([key, label]) => <div key={key}><Label>{label}</Label><Input type="password" value={metaForm[key] || ""} onChange={updateMetaField(key)} placeholder={metaForm[`${key}_masked`] || "Leave empty to keep existing"} className="mt-1.5 h-11" /></div>)}
              <div className="md:col-span-2 flex flex-wrap items-center gap-2"><Button type="button" onClick={handleMetaSave} disabled={metaBusy}>Save Configuration</Button><Button type="button" variant="outline" onClick={testMeta} disabled={metaBusy}>Test Configuration</Button>{metaMessage ? <span className="text-xs text-slate-600">{metaMessage}</span> : null}</div>
            </Section>
          ) : null}

          {!readOnly && whatsappForm ? (
            <Section title="WhatsApp Cloud API" subtitle="Configure WhatsApp Business / Cloud API lead intake without touching the working Meta integration." icon={SettingsIcon} badge="Admin">
              <div className="md:col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                Secrets are stored securely on the backend and are never displayed in full.
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={whatsappForm.enabled !== false} onChange={(e) => setWhatsappForm({ ...whatsappForm, enabled: e.target.checked })} /> Enable WhatsApp Lead Integration</label>
              <Field label="WhatsApp Phone Number ID" testId="settings-whatsapp-phone-number-id" value={whatsappForm.phone_number_id} onChange={updateWhatsappField("phone_number_id")} type="text" />
              <Field label="Business Account ID" testId="settings-whatsapp-business-account-id" value={whatsappForm.business_account_id} onChange={updateWhatsappField("business_account_id")} type="text" />
              <Field label="Graph API Version" testId="settings-whatsapp-graph-version" value={whatsappForm.graph_api_version} onChange={updateWhatsappField("graph_api_version")} type="text" />
              <div><Label>Default CRM Assignee</Label><select value={whatsappForm.default_assignee_id || ""} onChange={(e) => setWhatsappForm({ ...whatsappForm, default_assignee_id: e.target.value })} className="mt-1.5 h-11 w-full rounded-md border border-input px-3"><option value="">First active admin</option>{whatsappAssignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              {[["webhook_verify_token", "Webhook Verify Token"], ["app_secret", "App Secret"], ["access_token", "Access Token"]].map(([key, label]) => <div key={key}><Label>{label}</Label><Input type="password" value={whatsappForm[key] || ""} onChange={updateWhatsappField(key)} placeholder={whatsappForm[`${key}_masked`] || "Leave empty to keep existing"} className="mt-1.5 h-11" /></div>)}
              <div className="md:col-span-2 border-t border-border pt-4">
                <p className="text-sm font-semibold text-emerald-950">Automatic Replies and Templates</p>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  {[ ["default_auto_reply", "Default auto-reply"], ["customer_auto_reply", "Customer auto-reply"], ["member_auto_reply", "Member auto-reply"], ["partner_auto_reply", "Partner auto-reply"], ["invoice_template", "Invoice message template"], ["order_template", "Order message template"]].map(([key, label]) => <div key={key}><Label>{label}</Label><textarea value={whatsappForm[key] || ""} onChange={(e) => updateWhatsappField(key)(e.target.value)} placeholder={`Set ${label.toLowerCase()}`} className="mt-1.5 min-h-20 w-full rounded-md border border-input bg-white px-3 py-2 text-sm" /></div>)}
                  <div className="md:col-span-2 border-t border-border pt-3"><p className="text-sm font-semibold text-emerald-950">Registration Funnel</p></div>
                  {[ ["registration_welcome_message", "Welcome message"], ["registration_url", "General registration URL"], ["registration_help_prompt", "Registration help prompt"], ["registration_role_question", "Member / Partner / Rider selection question"]].map(([key, label]) => <div key={key} className={key === "registration_role_question" ? "md:col-span-2" : ""}><Label>{label}</Label><textarea value={whatsappForm[key] || ""} onChange={(e) => updateWhatsappField(key)(e.target.value)} placeholder={`Set ${label.toLowerCase()}`} className="mt-1.5 min-h-20 w-full rounded-md border border-input bg-white px-3 py-2 text-sm" /></div>)}
                  {[ ["Member", "member"], ["Partner", "partner"], ["Rider", "rider"] ].map(([title, role]) => <div key={role} className="md:col-span-2 border-t border-border pt-3"><p className="text-sm font-semibold text-emerald-950">{title} Registration</p><div className="mt-2 grid gap-3 md:grid-cols-2"><div><Label>{title} registration URL</Label><textarea value={whatsappForm[`${role}_registration_url`] || ""} onChange={(e) => updateWhatsappField(`${role}_registration_url`)(e.target.value)} placeholder="https://..." className="mt-1.5 min-h-20 w-full rounded-md border border-input bg-white px-3 py-2 text-sm" /></div><div><Label>{title} reply keywords (comma-separated)</Label><textarea value={whatsappForm[`${role}_registration_keywords`] || ""} onChange={(e) => updateWhatsappField(`${role}_registration_keywords`)(e.target.value)} placeholder="1, member" className="mt-1.5 min-h-20 w-full rounded-md border border-input bg-white px-3 py-2 text-sm" /></div><div className="md:col-span-2"><Label>{title} auto-reply</Label><textarea value={whatsappForm[`${role}_registration_reply`] || ""} onChange={(e) => updateWhatsappField(`${role}_registration_reply`)(e.target.value)} placeholder={`Set ${title.toLowerCase()} auto-reply`} className="mt-1.5 min-h-20 w-full rounded-md border border-input bg-white px-3 py-2 text-sm" /></div></div></div>)}
                </div>
              </div>
              <div className="md:col-span-2 flex flex-wrap items-center gap-2"><Button type="button" onClick={handleWhatsappSave} disabled={whatsappBusy}>Save Configuration</Button><Button type="button" variant="outline" onClick={testWhatsapp} disabled={whatsappBusy}>Test Configuration</Button>{whatsappMessage ? <span className="text-xs text-slate-600">{whatsappMessage}</span> : null}</div>
              <div className="md:col-span-2 border-t border-border pt-4">
                <p className="text-sm font-semibold text-emerald-950">Admin Reply</p>
                <div className="mt-2 grid gap-3 md:grid-cols-[minmax(0,0.4fr)_minmax(0,1fr)_auto]">
                  <Input value={whatsappReplyRecipient} onChange={(e) => setWhatsappReplyRecipient(e.target.value)} placeholder="Customer WhatsApp number" className="h-11" data-testid="settings-whatsapp-reply-recipient" />
                  <Input value={whatsappReplyText} onChange={(e) => setWhatsappReplyText(e.target.value)} placeholder="Write a reply" className="h-11" data-testid="settings-whatsapp-reply-text" />
                  <Button type="button" onClick={sendWhatsappReply} disabled={whatsappBusy} data-testid="settings-whatsapp-send-reply">Send Reply</Button>
                </div>
              </div>
            </Section>
          ) : null}

          {!readOnly && voiceCallerForm ? (
            <Section title="AI Voice Caller" subtitle="Provider settings are stored securely. The mock provider does not place calls." icon={SettingsIcon} badge="Admin">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={voiceCallerForm.enabled === true} onChange={updateVoiceCallerField("enabled")} /> Enable AI Voice Caller</label>
              <Field label="Provider" value={voiceCallerForm.provider ?? ""} onChange={updateVoiceCallerField("provider")} type="text" />
              <Field label="Caller / Provider ID" value={voiceCallerForm.caller_id || ""} onChange={updateVoiceCallerField("caller_id")} type="text" />
              <Field label="Bengali voice" value={voiceCallerForm.bengali_voice || ""} onChange={updateVoiceCallerField("bengali_voice")} type="text" />
              <Field label="Hindi voice" value={voiceCallerForm.hindi_voice || ""} onChange={updateVoiceCallerField("hindi_voice")} type="text" />
              <Field label="English voice" value={voiceCallerForm.english_voice || ""} onChange={updateVoiceCallerField("english_voice")} type="text" />
              <Field label="Model" value={voiceCallerForm.model || ""} onChange={updateVoiceCallerField("model")} type="text" />
              <Field label="Maximum call attempts" value={voiceCallerForm.max_call_attempts ?? ""} onChange={updateVoiceCallerField("max_call_attempts")} type="number" />
              <Field label="Retry delay (minutes)" value={voiceCallerForm.retry_delay_minutes ?? ""} onChange={updateVoiceCallerField("retry_delay_minutes")} type="number" />
              {[ ["api_key", "Provider API Key"], ["api_secret", "Provider API Secret"] ].map(([key, label]) => <div key={key}><Label>{label}</Label><Input type="password" value={voiceCallerForm[key] || ""} onChange={updateVoiceCallerField(key)} placeholder={voiceCallerForm[`${key}_masked`] || "Leave empty to keep existing"} className="mt-1.5 h-11" /></div>)}
              <div className="md:col-span-2 border-t border-border pt-4"><p className="text-sm font-semibold text-emerald-950">Provider Connection Profile</p></div>
              <Field label="Call Endpoint URL" value={voiceCallerForm.call_endpoint_url || ""} onChange={updateVoiceCallerField("call_endpoint_url")} type="url" placeholder="https://api.provider.com/v1/calls" />
              <Field label="Test Endpoint URL" value={voiceCallerForm.test_endpoint_url || ""} onChange={updateVoiceCallerField("test_endpoint_url")} type="url" placeholder="https://api.provider.com/v1/agents" />
              <div><Label>HTTP Method</Label><select value={voiceCallerForm.test_http_method || "GET"} onChange={updateVoiceCallerField("test_http_method")} className="mt-1.5 h-11 w-full rounded-md border border-input px-3"><option value="GET">GET</option><option value="POST">POST</option></select></div>
              <div><Label>Authentication Type</Label><select value={voiceCallerForm.auth_type || "bearer_token"} onChange={updateVoiceCallerField("auth_type")} className="mt-1.5 h-11 w-full rounded-md border border-input px-3"><option value="bearer_token">Bearer Token</option><option value="custom_header">Custom Header</option><option value="api_key_query_param">API Key Query Param</option></select></div>
              <Field label={voiceCallerForm.auth_type === "api_key_query_param" ? "Query Parameter Name" : "Header Name"} value={voiceCallerForm.auth_header_name || ""} onChange={updateVoiceCallerField("auth_header_name")} type="text" placeholder={voiceCallerForm.auth_type === "api_key_query_param" ? "api_key" : "Authorization"} />
              <Field label="Agent List Path" value={voiceCallerForm.agent_list_path || ""} onChange={updateVoiceCallerField("agent_list_path")} type="text" placeholder="data.agents (empty for a root list)" />
              <Field label="Agent ID Field Name" value={voiceCallerForm.agent_id_field || ""} onChange={updateVoiceCallerField("agent_id_field")} type="text" placeholder="id" />
              <Field label="Agent Name Field Name" value={voiceCallerForm.agent_name_field || ""} onChange={updateVoiceCallerField("agent_name_field")} type="text" placeholder="name" />
              <div className="md:col-span-2 flex flex-wrap items-center gap-2"><Button type="button" onClick={saveVoiceCaller} disabled={voiceCallerBusy}>Save Configuration</Button><Button type="button" variant="outline" onClick={testVoiceCaller} disabled={voiceCallerBusy}>Test Configuration</Button>{voiceCallerMessage ? <span className="text-xs text-slate-600">{voiceCallerMessage}</span> : null}</div>
            </Section>
          ) : null}

          <Section
            title="Razorpay Gateway"
            subtitle="Instant online payment via Razorpay Checkout. Enable only after entering live/test key pair."
            icon={QrCode}
            badge="Gateway"
          >
            <div className="md:col-span-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <p className="font-semibold">Razorpay setup</p>
              <p className="mt-1">Enable করলে checkout-এ "Pay Now with Razorpay" button দেখাবে। Manual UPI proof flow আগের মতোই থাকবে।</p>
            </div>
            <div>
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!form.razorpay_enabled}
                  onChange={(e) => setF("razorpay_enabled")(e.target.checked)}
                  className="w-4 h-4"
                  data-testid="settings-razorpay-enabled"
                />
                Enable Razorpay checkout
              </Label>
              <p className="text-[11px] text-muted-foreground mt-1">Off থাকলে Razorpay button hide থাকবে।</p>
            </div>
            <div>
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!form.manual_upi_enabled}
                  onChange={(e) => setF("manual_upi_enabled")(e.target.checked)}
                  className="w-4 h-4"
                  data-testid="settings-manual-upi-enabled"
                />
                Enable manual UPI proof flow
              </Label>
              <p className="text-[11px] text-muted-foreground mt-1">Off থাকলে checkout এবং partner top-up-এ manual UPI proof section hide থাকবে।</p>
            </div>
            <div>
              <Label>Razorpay Key ID</Label>
              <Input
                value={form.razorpay_key_id || ""}
                onChange={(e) => setF("razorpay_key_id")(e.target.value)}
                placeholder="rzp_live_xxxxx or rzp_test_xxxxx"
                className="mt-1.5 h-11 font-mono text-sm"
                data-testid="settings-razorpay-key-id"
              />
            </div>
            <div className="md:col-span-2">
              <Label>Razorpay Key Secret</Label>
              <Input
                type="password"
                value={form.razorpay_key_secret || ""}
                onChange={(e) => setF("razorpay_key_secret")(e.target.value)}
                placeholder="Enter Razorpay key secret"
                className="mt-1.5 h-11 font-mono text-sm"
                data-testid="settings-razorpay-key-secret"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Secret server-side verify-তে ব্যবহার হবে। এই value publish করবেন না।</p>
            </div>
          </Section>

          <Section
            title="Customer Mobile Entry + OTP"
            subtitle="Guest customer mobile number দিয়ে order history access control। এখন mobile-only চালু রাখতে পারেন, পরে OTP mode settings থেকে অন করুন।"
            icon={Users}
            badge="Retention"
          >
            <div className="md:col-span-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <p className="font-semibold">No code-touch switching</p>
              <p className="mt-1">Mobile-only mode দ্রুত customer ধরে রাখতে সাহায্য করবে। OTP mode-এ গেলে SMS/OTP delivery integration প্রয়োজন হতে পারে।</p>
            </div>
            <div>
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.customer_mobile_order_access_enabled !== false}
                  onChange={(e) => setF("customer_mobile_order_access_enabled")(e.target.checked)}
                  className="w-4 h-4"
                  data-testid="settings-customer-mobile-access-enabled"
                />
                Enable customer mobile order access
              </Label>
              <p className="text-[11px] text-muted-foreground mt-1">Off থাকলে /customer-orders flow disable থাকবে।</p>
            </div>
            <div>
              <Label>Verification Mode</Label>
              <select
                value={form.customer_mobile_access_mode || "mobile_only"}
                onChange={(e) => setF("customer_mobile_access_mode")(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                data-testid="settings-customer-mobile-access-mode"
              >
                <option value="mobile_only">Mobile only (fast entry)</option>
                <option value="mobile_otp">Mobile + OTP verification</option>
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">Current default: mobile-only.</p>
            </div>
            <Field
              label="Session Duration"
              testId="settings-customer-session-minutes"
              value={form.customer_order_session_minutes}
              onChange={setF("customer_order_session_minutes")}
              suffix="min"
              step="1"
              hint="Mobile entry successful হলে customer access token কত মিনিট valid থাকবে।"
            />
            <Field
              label="OTP TTL"
              testId="settings-customer-otp-ttl"
              value={form.customer_order_otp_ttl_seconds}
              onChange={setF("customer_order_otp_ttl_seconds")}
              suffix="sec"
              step="1"
              hint="OTP generation-এর পর কত seconds valid থাকবে।"
            />
            <Field
              label="OTP Length"
              testId="settings-customer-otp-length"
              value={form.customer_order_otp_length}
              onChange={setF("customer_order_otp_length")}
              suffix="digits"
              step="1"
              hint="OTP mode active থাকলে কত digit-এর OTP generate হবে।"
            />
            <Field
              label="Max OTP Attempts"
              testId="settings-customer-otp-attempts"
              value={form.customer_order_otp_max_attempts}
              onChange={setF("customer_order_otp_max_attempts")}
              suffix="tries"
              step="1"
              hint="ভুল OTP কতবার পর্যন্ত allow হবে।"
            />
            <div>
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!form.customer_order_otp_debug_mode}
                  onChange={(e) => setF("customer_order_otp_debug_mode")(e.target.checked)}
                  className="w-4 h-4"
                  data-testid="settings-customer-otp-debug"
                />
                Debug OTP preview in API response
              </Label>
              <p className="text-[11px] text-muted-foreground mt-1">SMS provider integration-এর আগে test environment-এ helpful। Production-এ off রাখুন।</p>
            </div>
            <div>
              <Label>Access Secret (optional)</Label>
              <Input
                type="password"
                value={form.customer_order_access_secret || ""}
                onChange={(e) => setF("customer_order_access_secret")(e.target.value)}
                placeholder="Custom signing secret"
                className="mt-1.5 h-11 font-mono text-sm"
                data-testid="settings-customer-access-secret"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Set করলে customer access token এই secret দিয়ে sign হবে।</p>
            </div>
          </Section>

          <ReferralMessageSection form={form} setF={setF} memberCode={user?.member_code} />

          <InstallShareSection />

          <Section
            title="Partner Slab Pricing Policy"
            subtitle="Associate Partner product-এ slab pricing apply হবে কি না তা toggle করুন।"
            icon={SettingsIcon}
            badge="On/Off"
          >
            <div className="md:col-span-2 rounded-lg border border-border p-4 bg-slate-50/40">
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!form.enable_partner_slab_pricing}
                  onChange={(e) => setF("enable_partner_slab_pricing")(e.target.checked)}
                  className="w-4 h-4"
                  data-testid="settings-enable-partner-slab-pricing"
                />
                Enable slab pricing for Associate Partner products
              </Label>
              <p className="text-[11px] text-muted-foreground mt-2">
                Off থাকলে partner product-এ quantity × unit price চলবে। On থাকলে configured tier pack rules apply হবে।
              </p>
            </div>
          </Section>

          <Section
            title="First Partner-Order Cashback"
            subtitle="নতুন member যখন প্রথম Partner-shop-এ order করবে, একবারই এই cashback তাদের wallet-এ auto-credit হবে।"
            icon={Gift}
            badge="One-time"
          >
            <Field
              label="Cashback %"
              testId="settings-first-cashback-percent"
              value={form.first_partner_order_cashback_percent}
              onChange={setF("first_partner_order_cashback_percent")}
              suffix="%"
              hint="Partner-item subtotal-এর এই % cashback। 0 দিলে offer disable।"
            />
            <Field
              label="Max Cashback Amount"
              testId="settings-first-cashback-max"
              value={form.first_partner_order_cashback_max}
              onChange={setF("first_partner_order_cashback_max")}
              suffix={form.currency_symbol || "₹"}
              hint="একটি cashback-এর maximum limit। 0 = no cap।"
            />
          </Section>

          <Section
            title="E-Invoice IRN (GSTN / GSP)"
            subtitle="GST Suvidha Provider বা NIC portal-এর সাথে আপনার invoice submit করুন। Mock mode-এ IRN generate হবে demo/dev-এর জন্য।"
            icon={FileCheck2}
            badge="Compliance"
          >
            <div>
              <Label className="flex items-center gap-2">
                <input type="checkbox" checked={!!form.einvoice_enabled} onChange={(e) => setF("einvoice_enabled")(e.target.checked)} className="w-4 h-4" data-testid="einv-enabled" />
                Enable E-Invoice submission
              </Label>
              <p className="text-[11px] text-muted-foreground mt-1 font-body">Enable করলে Invoice page-এ "Submit to GSTN" button দেখাবে (admin only)।</p>
            </div>
            <div>
              <Label>Provider</Label>
              <select value={form.einvoice_provider || "mock"} onChange={(e) => setF("einvoice_provider")(e.target.value)} className="mt-1.5 h-11 w-full rounded-md border border-input bg-white px-3 text-sm" data-testid="einv-provider">
                <option value="mock">Mock (demo IRN, no real submission)</option>
                <option value="generic_gsp">Generic GSP (Cleartax / Masters India / IRIS / custom)</option>
                <option value="nic_direct">NIC Direct (advanced — encryption required)</option>
              </select>
              <p className="text-[11px] text-muted-foreground mt-1 font-body">Mock — testing-এর জন্য। Generic GSP — যে-কোনো GSP-র REST endpoint।</p>
            </div>
            <div>
              <Label>API URL</Label>
              <Input value={form.einvoice_api_url || ""} onChange={(e) => setF("einvoice_api_url")(e.target.value)} placeholder="https://api.mastersindia.co/api/v2/eInvoice" className="mt-1.5 h-11 font-mono text-sm" data-testid="einv-api-url" />
            </div>
            <div>
              <Label>GSTIN</Label>
              <Input value={form.einvoice_gstin || ""} onChange={(e) => setF("einvoice_gstin")(e.target.value)} placeholder="15-char GSTIN" className="mt-1.5 h-11 font-mono uppercase" data-testid="einv-gstin" maxLength={15} />
            </div>
            <div>
              <Label>API Key / Bearer Token</Label>
              <Input type="password" value={form.einvoice_api_key || ""} onChange={(e) => setF("einvoice_api_key")(e.target.value)} placeholder="Bearer token" className="mt-1.5 h-11 font-mono" data-testid="einv-api-key" />
            </div>
            <div>
              <Label>Client ID</Label>
              <Input value={form.einvoice_client_id || ""} onChange={(e) => setF("einvoice_client_id")(e.target.value)} placeholder="From your GSP portal" className="mt-1.5 h-11 font-mono" data-testid="einv-client-id" />
            </div>
            <div>
              <Label>Client Secret</Label>
              <Input type="password" value={form.einvoice_client_secret || ""} onChange={(e) => setF("einvoice_client_secret")(e.target.value)} placeholder="••••••••" className="mt-1.5 h-11 font-mono" data-testid="einv-client-secret" />
            </div>
            <div>
              <Label>GST Portal Username</Label>
              <Input value={form.einvoice_username || ""} onChange={(e) => setF("einvoice_username")(e.target.value)} placeholder="For NIC direct only" className="mt-1.5 h-11" data-testid="einv-username" />
            </div>
            <div>
              <Label>GST Portal Password</Label>
              <Input type="password" value={form.einvoice_password || ""} onChange={(e) => setF("einvoice_password")(e.target.value)} placeholder="For NIC direct only" className="mt-1.5 h-11" data-testid="einv-password" />
            </div>
            <div className="md:col-span-2">
              <Label className="flex items-center gap-2">
                <input type="checkbox" checked={!!form.einvoice_sandbox} onChange={(e) => setF("einvoice_sandbox")(e.target.checked)} className="w-4 h-4" data-testid="einv-sandbox" />
                Sandbox mode (safe for testing)
              </Label>
              <p className="text-[11px] text-muted-foreground mt-1 font-body">
                Live mode-এ যাওয়ার আগে সব credentials ঠিক করে সাইনবক্স-এ test করুন।
              </p>
            </div>
          </Section>

          <Section
            title="Brand & Landing Essentials"
            subtitle="Landing page, shop, PWA — সব জায়গায় দেখানো logo/hero images এখান থেকে control করুন।"
            icon={ImageIcon}
            badge="Site-wide"
          >
            <div className="md:col-span-2 grid gap-3">
              <BrandingImageUpload
                purpose="site_logo"
                label="Site Logo"
                hint="Header ও PWA-তে দেখানো logo। Empty = default METHO logo।"
                value={form.site_logo_url}
                onChange={setF("site_logo_url")}
                onPersist={(value) => persistBrandingField("site_logo_url", value)}
                readOnly={readOnly}
                testId="branding-logo"
                uploadEndpoint="/admin/upload/site-logo"
              />
              <BrandingImageUpload
                purpose="social_share"
                label="Social Share Image (OG)"
                hint="WhatsApp/Facebook-এ link share করলে এই image preview হবে (1200×630)।"
                value={form.social_share_image_url}
                onChange={setF("social_share_image_url")}
                onPersist={(value) => persistBrandingField("social_share_image_url", value)}
                readOnly={readOnly}
                testId="branding-og"
                uploadEndpoint="/admin/upload/branding-image?purpose=social_share"
              />
              <BrandingImageUpload
                purpose="landing_tourism_banner"
                label="Tourism Section Banner"
                hint="Landing page-এর Tourism/Travel section-এ background হিসেবে দেখানো banner image (landscape format recommended)।"
                value={form.landing_tourism_banner_image_url}
                onChange={setF("landing_tourism_banner_image_url")}
                onPersist={(value) => persistBrandingField("landing_tourism_banner_image_url", value)}
                readOnly={readOnly}
                testId="branding-tourism-banner"
                uploadEndpoint="/admin/upload/branding-image?purpose=landing_tourism_banner"
              />
              <BrandingImageUpload
                purpose="landing_metho_delivery_banner"
                label="METHO Delivery Public Booking Banner"
                hint="Landing page-এর green quick action card-এর নিচে public booking CTA banner image।"
                value={form.landing_metho_delivery_banner_image_url}
                onChange={setF("landing_metho_delivery_banner_image_url")}
                onPersist={(value) => persistBrandingField("landing_metho_delivery_banner_image_url", value)}
                readOnly={readOnly}
                testId="branding-metho-delivery-banner"
                uploadEndpoint="/admin/upload/branding-image?purpose=landing_metho_delivery_banner"
              />
            </div>
            <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Landing Hero / Directory Hero / Product Placeholder settings থেকে সরানো হয়েছে।
              Landing partner list-এর visible picks নিচের control থেকে update করুন।
              <div className="mt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                  onClick={() => window.open("/app/products?upload=1", "_blank")}
                  data-testid="settings-go-products-upload"
                >
                  Product Upload / Top Product Control এ যান
                </Button>
              </div>
            </div>
            <div className="md:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4" data-testid="settings-landing-featured-partners">
              <p className="text-sm font-semibold text-emerald-950">Landing Featured Partner Shops</p>
              <p className="text-[11px] text-muted-foreground mt-1">Landing partner section-এর left side list-এ কোন partner shop দেখাবেন তা select করুন (max 12)।</p>
              <div className="mt-3 grid md:grid-cols-2 gap-3">
                {Array.from({ length: 12 }).map((_, index) => (
                  <div key={`landing-partner-slot-${index}`}>
                    <Label className="text-xs">Partner Slot {index + 1}</Label>
                    <select
                      value={landingFeaturedPartnerIds[index] || ""}
                      onChange={(e) => setLandingFeaturedPartnerSlot(index, e.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-emerald-200 bg-white px-3 text-sm"
                      data-testid={`settings-landing-partner-slot-${index + 1}`}
                    >
                      <option value="">Auto / Not selected</option>
                      {landingPartnerOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {landingPartnerOptionsLoading ? (
                <p className="mt-2 text-[11px] text-muted-foreground">Partner list loading...</p>
              ) : null}
            </div>
            <Field
              label="Landing Tagline"
              testId="settings-tagline"
              value={form.landing_tagline}
              onChange={setF("landing_tagline")}
              type="text"
              hint="Homepage-এর headline।"
            />
            <div>
              <Label>Landing Sub-heading</Label>
              <Textarea
                value={form.landing_subheading ?? ""}
                onChange={(e) => setF("landing_subheading")(e.target.value)}
                rows={3}
                data-testid="settings-subheading"
                className="mt-1.5"
                placeholder="Short pitch under the headline"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Headline-এর নিচে ছোট বর্ণনা।</p>
            </div>
            <div className="md:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4" data-testid="settings-landing-section-visibility">
              <p className="text-sm font-semibold text-emerald-950">Landing Section Visibility</p>
              <p className="text-[11px] text-muted-foreground mt-1">Landing page-এ কোন section দেখাবেন সেটা এখান থেকে control করুন।</p>
              <div className="mt-3 grid md:grid-cols-2 gap-3">
                <Label className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white p-3">
                  <input
                    type="checkbox"
                    checked={form.landing_show_metho_store !== false}
                    onChange={(e) => setF("landing_show_metho_store")(e.target.checked)}
                    className="w-4 h-4"
                    data-testid="settings-landing-show-metho-store"
                  />
                  Show METHO Store section
                </Label>
                <Label className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white p-3">
                  <input
                    type="checkbox"
                    checked={form.landing_show_partner_shop !== false}
                    onChange={(e) => setF("landing_show_partner_shop")(e.target.checked)}
                    className="w-4 h-4"
                    data-testid="settings-landing-show-partner-shop"
                  />
                  Show Partner Shop section
                </Label>
              </div>
            </div>
          </Section>

          <Section
            title="Company Management Achievers"
            subtitle="Top Leaders image, name, rank edit করতে পারবেন। Order: Leader 1=MD, Leader 2=CEO, Leader 3=Mentor, তারপর অন্যান্য Leader।"
            icon={Users}
            badge="Top Leaders"
          >
            <div className="md:col-span-2 grid gap-4">
              <div className="rounded-xl border border-border p-4 bg-slate-50/40">
                <p className="font-semibold text-emerald-950 mb-2">Leader 1 (MD)</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Name" testId="settings-top-leader-1-name" value={form.top_leader_1_name} onChange={setF("top_leader_1_name")} type="text" />
                  <Field label="Rank / Position (default: MD)" testId="settings-top-leader-1-title" value={form.top_leader_1_title} onChange={setF("top_leader_1_title")} type="text" />
                </div>
                <div className="mt-3">
                  <BrandingImageUpload
                    purpose="top_leader_1"
                    label="Leader 1 Image"
                    hint="Recommended: square portrait image"
                    value={form.top_leader_1_image_url}
                    onChange={setF("top_leader_1_image_url")}
                    onPersist={(value) => persistBrandingField("top_leader_1_image_url", value)}
                    readOnly={readOnly}
                    testId="branding-top-leader-1"
                    uploadEndpoint="/admin/upload/top-leader-image?slot=1"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 bg-slate-50/40">
                <p className="font-semibold text-emerald-950 mb-2">Leader 2 (CEO)</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Name" testId="settings-top-leader-2-name" value={form.top_leader_2_name} onChange={setF("top_leader_2_name")} type="text" />
                  <Field label="Rank / Position (default: CEO)" testId="settings-top-leader-2-title" value={form.top_leader_2_title} onChange={setF("top_leader_2_title")} type="text" />
                </div>
                <div className="mt-3">
                  <BrandingImageUpload
                    purpose="top_leader_2"
                    label="Leader 2 Image"
                    hint="Recommended: square portrait image"
                    value={form.top_leader_2_image_url}
                    onChange={setF("top_leader_2_image_url")}
                    onPersist={(value) => persistBrandingField("top_leader_2_image_url", value)}
                    readOnly={readOnly}
                    testId="branding-top-leader-2"
                    uploadEndpoint="/admin/upload/top-leader-image?slot=2"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 bg-slate-50/40">
                <p className="font-semibold text-emerald-950 mb-2">Leader 3 (Mentor)</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Name" testId="settings-top-leader-3-name" value={form.top_leader_3_name} onChange={setF("top_leader_3_name")} type="text" />
                  <Field label="Rank / Position (default: Mentor)" testId="settings-top-leader-3-title" value={form.top_leader_3_title} onChange={setF("top_leader_3_title")} type="text" />
                </div>
                <div className="mt-3">
                  <BrandingImageUpload
                    purpose="top_leader_3"
                    label="Leader 3 Image"
                    hint="Recommended: square portrait image"
                    value={form.top_leader_3_image_url}
                    onChange={setF("top_leader_3_image_url")}
                    onPersist={(value) => persistBrandingField("top_leader_3_image_url", value)}
                    readOnly={readOnly}
                    testId="branding-top-leader-3"
                    uploadEndpoint="/admin/upload/top-leader-image?slot=3"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 bg-slate-50/40">
                <p className="font-semibold text-emerald-950 mb-2">Leader 4</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Name" testId="settings-top-leader-4-name" value={form.top_leader_4_name} onChange={setF("top_leader_4_name")} type="text" />
                  <Field label="Rank / Position" testId="settings-top-leader-4-title" value={form.top_leader_4_title} onChange={setF("top_leader_4_title")} type="text" />
                </div>
                <div className="mt-3">
                  <BrandingImageUpload
                    purpose="top_leader_4"
                    label="Leader 4 Image"
                    hint="Recommended: square portrait image"
                    value={form.top_leader_4_image_url}
                    onChange={setF("top_leader_4_image_url")}
                    onPersist={(value) => persistBrandingField("top_leader_4_image_url", value)}
                    readOnly={readOnly}
                    testId="branding-top-leader-4"
                    uploadEndpoint="/admin/upload/top-leader-image?slot=4"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 bg-slate-50/40">
                <p className="font-semibold text-emerald-950 mb-2">Leader 5</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Name" testId="settings-top-leader-5-name" value={form.top_leader_5_name} onChange={setF("top_leader_5_name")} type="text" />
                  <Field label="Rank / Position" testId="settings-top-leader-5-title" value={form.top_leader_5_title} onChange={setF("top_leader_5_title")} type="text" />
                </div>
                <div className="mt-3">
                  <BrandingImageUpload
                    purpose="top_leader_5"
                    label="Leader 5 Image"
                    hint="Recommended: square portrait image"
                    value={form.top_leader_5_image_url}
                    onChange={setF("top_leader_5_image_url")}
                    onPersist={(value) => persistBrandingField("top_leader_5_image_url", value)}
                    readOnly={readOnly}
                    testId="branding-top-leader-5"
                    uploadEndpoint="/admin/upload/top-leader-image?slot=5"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 bg-slate-50/40">
                <p className="font-semibold text-emerald-950 mb-2">Leader 6</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Name" testId="settings-top-leader-6-name" value={form.top_leader_6_name} onChange={setF("top_leader_6_name")} type="text" />
                  <Field label="Rank / Position" testId="settings-top-leader-6-title" value={form.top_leader_6_title} onChange={setF("top_leader_6_title")} type="text" />
                </div>
                <div className="mt-3">
                  <BrandingImageUpload
                    purpose="top_leader_6"
                    label="Leader 6 Image"
                    hint="Recommended: square portrait image"
                    value={form.top_leader_6_image_url}
                    onChange={setF("top_leader_6_image_url")}
                    onPersist={(value) => persistBrandingField("top_leader_6_image_url", value)}
                    readOnly={readOnly}
                    testId="branding-top-leader-6"
                    uploadEndpoint="/admin/upload/top-leader-image?slot=6"
                  />
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Partner Registration Categories"
            subtitle="Admin এখান থেকে নতুন category/sub category add করলে Partner Register dropdown-এ auto show হবে।"
            icon={Sparkles}
            badge="Dynamic"
          >
            <div className="md:col-span-2 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border p-4 bg-slate-50/40">
                <p className="font-semibold text-emerald-950">Service Sectors</p>
                <div className="mt-3 flex gap-2">
                  <Input value={newServiceSector} onChange={(e) => setNewServiceSector(e.target.value)} placeholder="Add service sector" className="h-10" />
                  <Button type="button" variant="outline" className="rounded-full" onClick={addServiceSector}>Add</Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {mergedServiceSectors.map((sector) => {
                    const isDefault = DEFAULT_SERVICE_SECTORS.some((v) => v.toLowerCase() === sector.toLowerCase());
                    return (
                      <span key={sector} className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900">
                        {sector}
                        {!isDefault ? <button type="button" className="text-red-700" onClick={() => removeServiceSector(sector)}>x</button> : null}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 bg-slate-50/40">
                <p className="font-semibold text-emerald-950">Shop Sectors</p>
                <div className="mt-3 flex gap-2">
                  <Input value={newShopSector} onChange={(e) => setNewShopSector(e.target.value)} placeholder="Add shop sector" className="h-10" />
                  <Button type="button" variant="outline" className="rounded-full" onClick={addShopSector}>Add</Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {mergedShopSectors.map((sector) => {
                    const isDefault = DEFAULT_SHOP_SECTORS.some((v) => v.toLowerCase() === sector.toLowerCase());
                    return (
                      <span key={sector} className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900">
                        {sector}
                        {!isDefault ? <button type="button" className="text-red-700" onClick={() => removeShopSector(sector)}>x</button> : null}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="md:col-span-2 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border p-4 bg-white">
                <p className="font-semibold text-emerald-950">Service Sub Categories</p>
                <div className="mt-3 space-y-3">
                  {mergedServiceSectors.map((sector) => (
                    <div key={sector} className="rounded-lg border border-border p-3">
                      <p className="text-sm font-semibold text-emerald-900">{sector}</p>
                      <div className="mt-2 flex gap-2">
                        <Input value={newServiceSubBySector[sector] || ""} onChange={(e) => setNewServiceSubBySector((prev) => ({ ...prev, [sector]: e.target.value }))} placeholder="Add service sub category" className="h-9" />
                        <Button type="button" variant="outline" className="rounded-full" onClick={() => addServiceSubCategory(sector)}>Add</Button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(mergedServiceTemplates[sector] || []).map((item) => {
                          const isDefault = (DEFAULT_SERVICE_TEMPLATES_BY_SECTOR[sector] || []).some((v) => v.toLowerCase() === item.toLowerCase());
                          return (
                            <span key={`${sector}-${item}`} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2 py-1 text-[11px]">
                              {item}
                              {!isDefault ? <button type="button" className="text-red-700" onClick={() => removeServiceSubCategory(sector, item)}>x</button> : null}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 bg-white">
                <p className="font-semibold text-emerald-950">Shop Sub Categories</p>
                <div className="mt-3 space-y-3">
                  {mergedShopSectors.map((sector) => (
                    <div key={sector} className="rounded-lg border border-border p-3">
                      <p className="text-sm font-semibold text-emerald-900">{sector}</p>
                      <div className="mt-2 flex gap-2">
                        <Input value={newShopSubBySector[sector] || ""} onChange={(e) => setNewShopSubBySector((prev) => ({ ...prev, [sector]: e.target.value }))} placeholder="Add shop sub category" className="h-9" />
                        <Button type="button" variant="outline" className="rounded-full" onClick={() => addShopSubCategory(sector)}>Add</Button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(mergedShopTemplates[sector] || []).map((item) => {
                          const isDefault = (DEFAULT_SHOP_TEMPLATES_BY_SECTOR[sector] || []).some((v) => v.toLowerCase() === item.toLowerCase());
                          return (
                            <span key={`${sector}-${item}`} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2 py-1 text-[11px]">
                              {item}
                              {!isDefault ? <button type="button" className="text-red-700" onClick={() => removeShopSubCategory(sector, item)}>x</button> : null}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </fieldset>

        {!readOnly ? (
          <div className="sticky bottom-4 z-10">
            <div className="ml-auto w-full md:w-fit rounded-2xl border border-emerald-200 bg-white/95 backdrop-blur px-3 py-3 shadow-lg">
              <div className="flex items-center justify-between gap-3 md:justify-end">
                <p className="text-[11px] text-emerald-900 font-medium md:hidden">সব পরিবর্তন ready হলে Save করুন</p>
                <Button
                  type="submit"
                  disabled={saving || !splitValid}
                  className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-8 h-12 shadow-sm disabled:bg-slate-400"
                  data-testid="settings-save-button"
                >
                  <Save className="w-4 h-4 mr-2" /> {saving ? "Save হচ্ছে..." : "সব Settings Save করুন"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}


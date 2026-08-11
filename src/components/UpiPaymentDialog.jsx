import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Upload, Loader2, QrCode, Copy, CheckCircle2 } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { QRCodeCanvas } from "qrcode.react";
import { resolveAssetUrl, buildUpiPaymentUri } from "@/lib/utils";

const GUEST_CHECKOUT_PREFS_KEY = "metho_guest_checkout_prefs_v1";
const RESTAURANT_SLOT_TEMPLATE_KEYS = new Set([
  "restaurant_table_booking",
  "banquet_slot",
  "restaurant_takeaway_slot",
  "cafe_table_reservation",
]);
const SERVICE_SLOT_TEMPLATE_KEYS = new Set([
  "restaurant_table_booking",
  "banquet_slot",
  "restaurant_takeaway_slot",
  "cafe_table_reservation",
  "ac_service_visit",
  "plumbing_repair",
  "electrician_visit",
  "appliance_repair",
  "laundry_kg_service",
  "dry_clean_service",
  "tailoring_stitching",
  "beauty_home_service",
  "courier_pickup",
  "house_deep_clean",
  "office_cleaning",
  "pest_control_visit",
  "doctor_consultation",
  "diagnostic_visit",
  "tele_consultation",
  "dental_checkup",
  "pathology_test_slot",
  "ultrasound_slot",
  "yoga_class_slot",
  "tuition_monthly_batch",
  "coaching_mock_test",
  "salon_haircut",
  "salon_grooming_package",
  "salon_bridal_package",
  "spa_session",
  "gym_personal_training",
  "photo_event_shoot",
  "video_shoot_edit",
]);
const DELIVERY_PARTNER_TEMPLATE_KEYS = new Set(["courier_pickup", "cargo_transport"]);
const TRANSPORT_TEMPLATE_KEYS = new Set(["cab_airport_drop", "car_rental_daily", "bike_rental_daily"]);

const normalizeText = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const extractPincodeFromAddress = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 6 ? digits.slice(-6) : "";
};

const extractCityFromAddress = (value) => {
  const parts = normalizeText(value).replace(/;/g, ",").split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (!/\d/.test(parts[index])) return parts[index];
  }
  return parts[parts.length - 1];
};

const readGuestCheckoutPrefs = () => {
  try {
    const raw = window.localStorage.getItem(GUEST_CHECKOUT_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const writeGuestCheckoutPrefs = (prefs) => {
  try {
    window.localStorage.setItem(GUEST_CHECKOUT_PREFS_KEY, JSON.stringify(prefs || {}));
  } catch {
    // Ignore storage failures.
  }
};

const loadRazorpayScript = () => new Promise((resolve) => {
  if (typeof window === "undefined") return resolve(false);
  if (window.Razorpay) return resolve(true);
  const script = document.createElement("script");
  script.src = "https://checkout.razorpay.com/v1/checkout.js";
  script.async = true;
  script.onload = () => resolve(true);
  script.onerror = () => resolve(false);
  document.body.appendChild(script);
});

const extractApiErrorMessage = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") {
    const message = detail.message || detail.error;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (typeof err?.message === "string" && err.message.trim()) return err.message;
  return fallback;
};

const extractSuggestedSlot = (message) => {
  const match = String(message || "").match(/Try next slot:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2})/i);
  return match?.[1] || "";
};

/**
 * UpiPaymentDialog — shows admin's UPI QR + collects txn_id and screenshot.
 * onOrderPlaced callback fires with the created order after submit.
 */
export default function UpiPaymentDialog({
  open,
  onOpenChange,
  items,          // [{ id, name, price, quantity, subtotal }, ...]
  total,
  onOrderPlaced, // (order) => void
  existingOrderId = null,  // if resubmitting for existing order
  isGuest = false,
  memberRef = "",
  onMemberRefChange,
  paymentConfig = null,
}) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [address, setAddress] = useState("");
  const [txnId, setTxnId] = useState("");
  const [payerName, setPayerName] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [slotDateTime, setSlotDateTime] = useState("");
  const [slotGuestCount, setSlotGuestCount] = useState("1");
  const [paymentMode, setPaymentMode] = useState("upi");
  const [screenshot, setScreenshot] = useState(null); // { url, storage_path }
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [forceManualUpiFlow, setForceManualUpiFlow] = useState(false);
  const [qrImageFailed, setQrImageFailed] = useState(false);
  const [memberLookupBusy, setMemberLookupBusy] = useState(false);
  const [memberLookupInfo, setMemberLookupInfo] = useState(null);
  const codEnabled = paymentConfig ? paymentConfig.cod_enabled !== false : true;
  const normalizedPayerPhone = String(payerPhone || "").replace(/\D/g, "");
  const normalizedUserPhone = String(user?.phone || "").replace(/\D/g, "");
  const resolvedPayerName = String(payerName || "").trim() || String(user?.name || "").trim();
  const resolvedCustomerPhone = normalizedPayerPhone || normalizedUserPhone;
  const normalizedUserRole = String(user?.role || "").trim().toLowerCase();
  const shouldAutoAttachMemberId = Boolean(
    user?.id &&
    normalizedUserRole &&
    !["partner", "store_owner", "metho_store_owner", "owner", "admin", "super_admin", "company_admin"].includes(normalizedUserRole)
  );
  const requiresShippingAddress = Array.isArray(items)
    ? items.some((item) => !(item?.is_service || String(item?.listing_type || item?.item_kind || "").toLowerCase().includes("service")))
    : true;
  const requiresRestaurantSlot = Array.isArray(items)
    ? items.some((item) => {
      const key = String(item?.service_template_key || "").trim().toLowerCase();
      return RESTAURANT_SLOT_TEMPLATE_KEYS.has(key);
    })
    : false;
  const requiresServiceSlot = Array.isArray(items)
    ? items.some((item) => {
      const listingHint = String(item?.listing_type || item?.item_kind || "").toLowerCase();
      const isService = Boolean(item?.is_service || listingHint.includes("service"));
      if (!isService) return false;
      const key = String(item?.service_template_key || "").trim().toLowerCase();
      if (TRANSPORT_TEMPLATE_KEYS.has(key)) return false;
      return true;
    })
    : false;
  const requiresDeliveryAreaCheck = Array.isArray(items)
    ? items.some((item) => DELIVERY_PARTNER_TEMPLATE_KEYS.has(String(item?.service_template_key || "").trim().toLowerCase()))
    : false;
  const configuredDeliveryCity = normalizeText(paymentConfig?.delivery_city || "");
  const configuredDeliveryPincode = String(paymentConfig?.delivery_pincode || "").replace(/\D/g, "");
  const customerCity = extractCityFromAddress(address);
  const customerPincode = extractPincodeFromAddress(address);
  const deliveryAreaMismatch = requiresDeliveryAreaCheck && (configuredDeliveryCity || configuredDeliveryPincode)
    ? Boolean((configuredDeliveryCity && customerCity && configuredDeliveryCity !== customerCity) || (configuredDeliveryPincode && customerPincode && configuredDeliveryPincode !== customerPincode))
    : false;

  useEffect(() => {
    if (!open) return;
    api.get("/settings").then((r) => setSettings(r.data)).catch(() => {});
  }, [open, paymentConfig]);

  useEffect(() => {
    if (open) return;
    setForceManualUpiFlow(false);
    setPaymentMode("upi");
  }, [open]);

  useEffect(() => {
    if (paymentMode === "cod" && !codEnabled) {
      setPaymentMode("upi");
    }
  }, [paymentMode, codEnabled]);

  useEffect(() => {
    if (!open || isGuest || normalizedUserRole !== "member") return;
    if (!String(payerName || "").trim() && String(user?.name || "").trim()) {
      setPayerName(String(user.name).trim());
    }
    if (!String(payerPhone || "").trim() && String(user?.phone || "").trim()) {
      setPayerPhone(String(user.phone).trim());
    }
  }, [open, isGuest, normalizedUserRole, user?.name, user?.phone, payerName, payerPhone]);

  useEffect(() => {
    if (!open || !isGuest) return;
    const saved = readGuestCheckoutPrefs();
    if (!saved) return;

    if (!String(payerPhone || "").trim() && String(saved.payer_phone || "").trim()) {
      setPayerPhone(String(saved.payer_phone).trim());
    }
    if (!String(payerName || "").trim() && String(saved.payer_name || "").trim()) {
      setPayerName(String(saved.payer_name).trim());
    }
    if (!String(address || "").trim() && String(saved.shipping_address || "").trim()) {
      setAddress(String(saved.shipping_address).trim());
    }
  }, [open, isGuest, payerPhone, payerName, address]);

  useEffect(() => {
    if (!isGuest) return;
    writeGuestCheckoutPrefs({
      payer_phone: String(payerPhone || "").trim(),
      payer_name: String(payerName || "").trim(),
      shipping_address: String(address || "").trim(),
    });
  }, [isGuest, payerPhone, payerName, address]);

  useEffect(() => {
    const ref = String(memberRef || "").trim();
    if (!open || !ref) {
      setMemberLookupInfo(null);
      return;
    }
    const timer = setTimeout(async () => {
      setMemberLookupBusy(true);
      try {
        const { data } = await api.get(`/member-lookup/${encodeURIComponent(ref)}`);
        setMemberLookupInfo(data);
        if (!String(payerName || "").trim() && String(data?.name || "").trim()) {
          setPayerName(String(data.name).trim());
        }
        if (!String(payerPhone || "").trim() && String(data?.phone || "").trim()) {
          setPayerPhone(String(data.phone).trim());
        }
      } catch {
        setMemberLookupInfo(null);
      } finally {
        setMemberLookupBusy(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [open, memberRef, payerName, payerPhone]);

  const copyUpi = async () => {
    if (!settings?.upi_id) return;
    try {
      await navigator.clipboard.writeText(settings.upi_id);
      setCopied(true);
      toast.success("UPI ID copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed");
    }
  };

  const showCheckoutError = (err, fallbackMessage) => {
    const message = extractApiErrorMessage(err, fallbackMessage);
    const suggestedSlot = extractSuggestedSlot(message);
    if (suggestedSlot && requiresServiceSlot) {
      setSlotDateTime(suggestedSlot);
      toast.error(`${message} Suggested slot filled automatically.`);
      return;
    }
    toast.error(message);
  };

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/upload/payment-screenshot", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setScreenshot(data);
      toast.success("Screenshot uploaded");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!existingOrderId && !resolvedCustomerPhone) return toast.error("Order-এর জন্য Mobile Number দিন");
    if (!existingOrderId && !resolvedPayerName) return toast.error("Order-এর জন্য Customer Name দিন");
    if (existingOrderId && paymentMode === "cod") return toast.error("COD is only available for new checkout");
    if (paymentMode === "cod" && !codEnabled) return toast.error("COD is not available for this partner");
    if (paymentMode === "cod" && !resolvedCustomerPhone) return toast.error("COD order-এর জন্য Mobile Number দিন");
    if (paymentMode === "cod" && !resolvedPayerName) return toast.error("COD order-এর জন্য Customer Name দিন");
    if (!existingOrderId && requiresShippingAddress && !address.trim()) return toast.error("Please enter shipping address");
    if (!existingOrderId && deliveryAreaMismatch) return toast.error(`Delivery is available only in ${[paymentConfig?.delivery_city, paymentConfig?.delivery_pincode].filter(Boolean).join(", ")}`);
    if (!existingOrderId && requiresServiceSlot && !slotDateTime.trim()) return toast.error("Service slot date and time দিন");
    if (!existingOrderId && requiresRestaurantSlot && Number(slotGuestCount || 0) <= 0) return toast.error("Guest count দিন");
    if (paymentMode === "upi") {
      if (!txnId.trim()) return toast.error("Please enter UPI Transaction ID");
      if (!screenshot?.url) return toast.error("Please upload payment screenshot");
    }
    setSubmitting(true);
    try {
      const payload = {
        items: items.map((i) => ({
          product_id: i.id,
          quantity: i.quantity,
          listing_type: i.listing_type,
          item_kind: i.item_kind,
          is_service: i.is_service,
          service_invoice_mode: i.service_invoice_mode,
          service_template_key: i.service_template_key,
        })),
        shipping_address: requiresShippingAddress ? address : "",
        payment_method: paymentMode === "cod" ? "cod" : "upi",
        txn_id: paymentMode === "cod" ? "COD" : txnId.trim(),
        payment_screenshot_url: paymentMode === "cod" ? "" : screenshot.url,
        payer_name: resolvedPayerName || undefined,
        customer_phone: resolvedCustomerPhone,
        slot_datetime: requiresServiceSlot ? slotDateTime : "",
        guest_count: requiresRestaurantSlot ? Number(slotGuestCount || 0) : 0,
      };
      const ref = (memberRef || "").trim();
      if (ref) {
        const looksLikeMemberCode = /^MTH-/i.test(ref);
        if (looksLikeMemberCode) payload.member_code = ref.toUpperCase();
        else payload.member_id = ref;
      } else if (!isGuest && shouldAutoAttachMemberId) {
        payload.member_id = user.id;
      }
      const endpoint = existingOrderId ? `/orders/${existingOrderId}/submit-payment` : "/orders";
      const { data } = await api.post(endpoint, payload);
      if (paymentMode === "cod") {
        toast.success("COD order placed. Delivery charges should be discussed and negotiated directly with the partner.", { duration: 5000 });
      } else {
        toast.success(
          data?.status === "paid"
            ? "Payment verified. Invoice generated."
            : (data?.approval_reason || "Order placed! Recharge reserve wallet if needed, then invoice will generate."),
          { duration: 4500 }
        );
      }
      onOrderPlaced?.(data);
      if (isGuest) {
        writeGuestCheckoutPrefs({
          payer_phone: String(payerPhone || "").trim(),
          payer_name: String(payerName || "").trim(),
          shipping_address: String(address || "").trim(),
        });
      }
      // Reset
      setTxnId(""); setPayerName(""); setPayerPhone(""); setScreenshot(null); setAddress("");
      setSlotDateTime(""); setSlotGuestCount("1");
      setPaymentMode("upi");
    } catch (err) {
      showCheckoutError(err, "Order submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const submitRazorpay = async () => {
    if (existingOrderId) {
      toast.error("Razorpay flow supports new checkout only");
      return;
    }
    if (requiresShippingAddress && !address.trim()) return toast.error("Please enter shipping address");
    if (requiresServiceSlot && !slotDateTime.trim()) return toast.error("Service slot date and time দিন");
    if (requiresRestaurantSlot && Number(slotGuestCount || 0) <= 0) return toast.error("Guest count দিন");
    if (!resolvedPayerName) return toast.error("Order-এর জন্য Customer Name দিন");
    if (isGuest && !normalizedPayerPhone) return toast.error("Please enter mobile number");
    if (!resolvedCustomerPhone) return toast.error("Please enter mobile number");

    setSubmitting(true);
    try {
      const orderPayload = {
        items: items.map((i) => ({
          product_id: i.id,
          quantity: i.quantity,
          listing_type: i.listing_type,
          item_kind: i.item_kind,
          is_service: i.is_service,
          service_invoice_mode: i.service_invoice_mode,
          service_template_key: i.service_template_key,
        })),
        shipping_address: requiresShippingAddress ? address : "",
        payment_method: "razorpay",
        payer_name: resolvedPayerName || undefined,
        customer_phone: resolvedCustomerPhone,
        slot_datetime: requiresServiceSlot ? slotDateTime : "",
        guest_count: requiresRestaurantSlot ? Number(slotGuestCount || 0) : 0,
      };
      const ref = (memberRef || "").trim();
      if (ref) {
        const looksLikeMemberCode = /^MTH-/i.test(ref);
        if (looksLikeMemberCode) orderPayload.member_code = ref.toUpperCase();
        else orderPayload.member_id = ref;
      } else if (!isGuest && shouldAutoAttachMemberId) {
        orderPayload.member_id = user.id;
      }

      const { data: created } = await api.post("/orders", orderPayload);
      const createdOrderId = String(created?.order_id || created?.id || "").trim();
      if (!createdOrderId) throw new Error("Order creation failed");

      const sdkLoaded = await loadRazorpayScript();
      if (!sdkLoaded) {
        toast.error("Razorpay SDK failed to load. Please try again.");
        return;
      }

      let rp;
      try {
        const rpResp = await api.post("/payments/razorpay/order", { order_id: createdOrderId });
        rp = rpResp.data;
      } catch (err) {
        if (err?.response?.status === 404) {
          setForceManualUpiFlow(true);
          setSubmitting(false);
          toast.error("Online Razorpay is unavailable right now. Please submit UPI proof to complete this order.");
          return;
        }
        throw err;
      }

      const options = {
        key: rp.key_id,
        amount: rp.amount,
        currency: rp.currency || "INR",
        name: rp.name || "METHOO STORE",
        description: rp.description || "Order payment",
        order_id: rp.razorpay_order_id,
        handler: async (resp) => {
          try {
            const { data: verified } = await api.post("/payments/razorpay/verify-and-submit", {
              order_id: createdOrderId,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
              payer_name: resolvedPayerName || undefined,
              customer_phone: resolvedCustomerPhone || undefined,
            });
            toast.success(
              verified?.status === "paid"
                ? "Payment successful. Invoice generated."
                : (verified?.approval_reason || "Payment received. Admin approval pending."),
              { duration: 4500 }
            );
            onOrderPlaced?.(verified);
            if (isGuest) {
              writeGuestCheckoutPrefs({
                payer_phone: String(payerPhone || "").trim(),
                payer_name: String(payerName || "").trim(),
                shipping_address: String(address || "").trim(),
              });
            }
            setTxnId("");
            setPayerName("");
            setPayerPhone("");
            setScreenshot(null);
            setAddress("");
            setSlotDateTime("");
            setSlotGuestCount("1");
          } catch (err) {
            toast.error(err?.response?.data?.detail || "Payment verification failed");
          } finally {
            setSubmitting(false);
          }
        },
        modal: {
          ondismiss: () => setSubmitting(false),
        },
        prefill: {
          name: resolvedPayerName || undefined,
          contact: resolvedCustomerPhone || undefined,
          email: user?.email || undefined,
        },
        notes: {
          metho_order_id: createdOrderId,
          customer_phone: resolvedCustomerPhone || undefined,
        },
        theme: {
          color: "#065f46",
        },
      };

      const rz = new window.Razorpay(options);
      rz.on("payment.failed", (resp) => {
        toast.error(resp?.error?.description || "Payment failed");
        setSubmitting(false);
      });
      rz.open();
    } catch (err) {
      setSubmitting(false);
      showCheckoutError(err, "Razorpay checkout failed");
    }
  };

  const upiId = paymentConfig?.upi_id || settings?.upi_id || "methopvtltd@paytm";
  const payeeName = paymentConfig?.payee_name || settings?.upi_payee_name || "METHOO STORE";
  const qrUrl = paymentConfig?.qr_url || settings?.upi_qr_url;
  const fallbackQrValue = buildUpiPaymentUri(upiId, payeeName, total);
  const payLabel = paymentConfig?.label || "UPI Payment";
  const manualUpiEnabled = forceManualUpiFlow || (paymentConfig ? paymentConfig.manual_upi_enabled !== false : !!settings?.manual_upi_enabled);
  const razorpayEnabled = paymentConfig
    ? !!paymentConfig.razorpay_enabled && !!settings?.razorpay_enabled && !!settings?.razorpay_key_id
    : !!settings?.razorpay_enabled && !!settings?.razorpay_key_id;
  const goBackToCart = () => {
    onOpenChange?.(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-emerald-700" />
            {payLabel} · ₹{total.toLocaleString("en-IN")}
          </DialogTitle>
          <DialogDescription>
            {razorpayEnabled
              ? "Complete payment using UPI proof flow, or pay instantly with Razorpay checkout."
              : "Complete payment using UPI QR/UPI proof flow."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900" data-testid="upi-otp-safety-notice">
          <p className="font-semibold">Security warning: METHO never asks for OTP, UPI PIN, ATM PIN, CVV, or full bank details.</p>
          <p className="mt-1">Security Alert: METHO never asks for OTP, UPI PIN, ATM PIN, CVV, or full bank details. If anyone asks in METHO's name, do not share.</p>
        </div>

        {items?.length > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-800 font-bold">Cart Preview</p>
              <p className="text-xs text-emerald-900 font-semibold">{items.length} item(s)</p>
            </div>
            <div className="grid gap-2 max-h-48 overflow-y-auto pr-1">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-lg bg-white border border-emerald-100 p-2">
                  <div className="w-12 h-12 rounded-md bg-slate-100 overflow-hidden shrink-0 border border-slate-200">
                    {item.image_url ? (
                      <img src={resolveAssetUrl(item.image_url)} alt={item.name || "product"} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400 text-[10px]">No Image</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-emerald-950 truncate text-sm">{item.name}</p>
                    <p className="text-[11px] text-slate-500 truncate">Qty {item.quantity} · ₹{Number(item.subtotal || 0).toLocaleString("en-IN")}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={submit} className={manualUpiEnabled ? "grid md:grid-cols-2 gap-6" : "space-y-4"} data-testid="upi-payment-form">
          {manualUpiEnabled ? (
            <>
              {/* LEFT: UPI details */}
              <div className="space-y-4">
                <div className="rounded-xl bg-gradient-to-br from-emerald-950 to-emerald-800 text-white p-5">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-bold">Step 1 · Pay via any UPI app</p>
                  <p className="text-2xl font-display font-black mt-2">₹{total.toLocaleString("en-IN")}</p>
                  <p className="text-xs text-emerald-100/80 mt-1">GPay, PhonePe, Paytm, BHIM — all are supported</p>

                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg bg-white/10 p-3">
                      <p className="text-[10px] uppercase text-amber-400 font-bold">Payee Name</p>
                      <p className="font-semibold">{payeeName}</p>
                    </div>
                    <button
                      type="button"
                      onClick={copyUpi}
                      className="w-full rounded-lg bg-white/15 hover:bg-white/25 transition-colors p-3 text-left"
                      data-testid="copy-upi-button"
                    >
                      <p className="text-[10px] uppercase text-amber-400 font-bold flex items-center justify-between">
                        UPI ID (tap to copy)
                        {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </p>
                      <p className="font-mono text-sm break-all mt-0.5">{upiId}</p>
                    </button>
                  </div>
                </div>

                {qrUrl && !qrImageFailed ? (
                  <div className="rounded-xl border border-border p-3 bg-white text-center">
                    <p className="text-[10px] uppercase text-emerald-800 font-bold tracking-wider mb-2">Scan QR Code</p>
                    <img
                      src={resolveAssetUrl(qrUrl)}
                      alt="UPI QR"
                      className="w-full max-w-[240px] mx-auto object-contain rounded-lg"
                      onError={() => setQrImageFailed(true)}
                    />
                  </div>
                ) : fallbackQrValue ? (
                  <div className="rounded-xl border border-border p-3 bg-white text-center">
                    <p className="text-[10px] uppercase text-emerald-800 font-bold tracking-wider mb-2">Scan QR Code</p>
                    <div className="flex justify-center">
                      <QRCodeCanvas value={fallbackQrValue} size={220} level="H" includeMargin />
                    </div>
                    <p className="text-[11px] text-slate-500 mt-2">
                      Preview generated from the UPI details because the uploaded QR image is not currently reachable.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 text-center">
                    <QrCode className="w-8 h-8 text-amber-700 mx-auto" />
                    <p className="text-xs text-amber-900 font-semibold mt-2">
                      QR is not uploaded yet — copy the UPI ID above and pay using any UPI app.
                    </p>
                  </div>
                )}
              </div>

              {/* RIGHT: Confirmation form */}
              <div className="space-y-3">
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-amber-900 font-bold">Step 2 · Confirm payment</p>
                  <p className="text-xs text-amber-800 mt-1">
                    {paymentMode === "cod"
                      ? "Place your COD request now. Delivery charges should be discussed and negotiated directly with the partner."
                      : "After payment, copy the Transaction ID from your UPI app and upload a screenshot."}
                  </p>
                </div>

                {!existingOrderId ? (
                  <div>
                    <Label htmlFor="payment-mode">Payment Mode</Label>
                    <select
                      id="payment-mode"
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(String(e.target.value || "upi"))}
                      className="mt-1.5 h-11 rounded-md border border-input px-3 bg-white text-slate-900 w-full"
                      data-testid="payment-mode-select"
                    >
                      <option value="upi">UPI Payment Proof</option>
                        {codEnabled ? <option value="cod">Cash on Delivery (COD)</option> : null}
                    </select>
                      {paymentMode === "cod" && codEnabled ? (
                      <p className="text-[11px] text-slate-700 mt-1">
                        Cash on Delivery (COD) is available. Delivery charges will be discussed and negotiated directly with the partner before final confirmation.
                      </p>
                    ) : null}
                      {!codEnabled ? (
                        <p className="text-[11px] text-slate-500 mt-1">COD is currently disabled by this partner.</p>
                      ) : null}
                  </div>
                ) : null}

                {!existingOrderId && (
              <div>
                <Label htmlFor="member-ref">Member ID / Member Code (optional)</Label>
                <Input
                  id="member-ref"
                  value={memberRef || ""}
                  onChange={(e) => onMemberRefChange?.(e.target.value)}
                  placeholder="e.g. MTH-123456 or member UUID"
                  data-testid="guest-member-ref-input"
                  className="mt-1.5 h-11 font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Leave blank for plain guest purchase. Provide Member ID/Code only if reward percentage attribution is needed.
                </p>
                {memberLookupBusy ? <p className="text-[11px] text-slate-500 mt-1">Checking member...</p> : null}
                {memberLookupInfo ? (
                  <p className="text-[11px] text-emerald-700 mt-1">
                    Member found: {memberLookupInfo?.name || "Member"}
                    {memberLookupInfo?.member_code ? ` · ${memberLookupInfo.member_code}` : ""}
                  </p>
                ) : null}
              </div>
            )}

                {!existingOrderId && requiresServiceSlot ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-3">
                    <p className="text-[11px] font-semibold text-amber-900">Service Slot Details</p>
                    <div>
                      <Label htmlFor="restaurant-slot-time">Slot Date & Time <span className="text-red-500">*</span></Label>
                      <Input
                        id="restaurant-slot-time"
                        type="datetime-local"
                        value={slotDateTime}
                        onChange={(e) => setSlotDateTime(e.target.value)}
                        className="mt-1.5 h-11"
                        data-testid="restaurant-slot-datetime"
                      />
                    </div>
                    {requiresRestaurantSlot ? (
                    <div>
                      <Label htmlFor="restaurant-slot-guests">Guest Count <span className="text-red-500">*</span></Label>
                      <Input
                        id="restaurant-slot-guests"
                        type="number"
                        min="1"
                        step="1"
                        value={slotGuestCount}
                        onChange={(e) => setSlotGuestCount(e.target.value)}
                        className="mt-1.5 h-11"
                        data-testid="restaurant-slot-guests"
                      />
                    </div>
                    ) : null}
                  </div>
                ) : null}

                {!existingOrderId && requiresShippingAddress && (
              <div>
                <Label htmlFor="ship">Shipping Address <span className="text-red-500">*</span></Label>
                <Textarea
                  id="ship"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Full address with pincode..."
                  data-testid="upi-shipping-input"
                  className="mt-1.5 min-h-[70px]"
                />
                {deliveryAreaMismatch ? (
                  <p className="text-[11px] text-red-700 mt-1">
                    Delivery is currently limited to {[paymentConfig?.delivery_city, paymentConfig?.delivery_pincode].filter(Boolean).join(", ")}.
                  </p>
                ) : paymentConfig?.delivery_city || paymentConfig?.delivery_pincode ? (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Delivery area: {[paymentConfig?.delivery_city, paymentConfig?.delivery_pincode].filter(Boolean).join(", ")}.
                  </p>
                ) : null}
              </div>
            )}

                {paymentMode !== "cod" ? (
                  <div>
                    <Label htmlFor="txn">UPI Transaction ID <span className="text-red-500">*</span></Label>
                    <Input
                      id="txn"
                      required
                      value={txnId}
                      onChange={(e) => setTxnId(e.target.value)}
                      placeholder="e.g. T2506191234567890"
                      data-testid="upi-txn-input"
                      className="mt-1.5 h-11 font-mono text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Use UTR / Transaction Reference from your UPI success screen.
                    </p>
                  </div>
                ) : null}

                <div>
              <Label htmlFor="payer-phone">Mobile Number</Label>
              <Input
                id="payer-phone"
                value={payerPhone}
                onChange={(e) => setPayerPhone(e.target.value)}
                placeholder="e.g. 98XXXXXXXX"
                data-testid="upi-phone-input"
                className="mt-1.5 h-11"
              />
                </div>

                <div>
              <Label htmlFor="payer">Payer Name (optional)</Label>
              <Input
                id="payer"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                placeholder="If payment was made from a different account"
                data-testid="upi-payer-input"
                className="mt-1.5 h-11"
              />
                </div>

                {paymentMode !== "cod" ? (
                  <div>
                    <Label>Payment Screenshot <span className="text-red-500">*</span></Label>
                    <label className="mt-1.5 flex items-center justify-center gap-2 border-2 border-dashed border-emerald-300 rounded-lg p-4 hover:bg-emerald-50/60 cursor-pointer transition-colors">
                      <input type="file" accept="image/*" className="hidden" onChange={handleFile} data-testid="upi-screenshot-input" />
                      {uploading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
                      ) : screenshot?.url ? (
                        <div className="flex items-center gap-3">
                          <img src={resolveAssetUrl(screenshot.url)} alt="proof" className="h-14 w-14 object-cover rounded" />
                          <span className="text-emerald-700 font-semibold text-sm flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Uploaded — click to change</span>
                        </div>
                      ) : (
                        <><Upload className="w-4 h-4 text-emerald-700" /> <span className="text-sm text-emerald-800 font-semibold">Select screenshot</span></>
                      )}
                    </label>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {razorpayEnabled
                  ? "Manual UPI proof flow is hidden by admin. Use Razorpay below if it is enabled."
                  : "Razorpay is disabled in this checkout flow. Partner payments require the UPI/QR proof flow to stay active."}
              </div>

              {!existingOrderId ? (
                <div>
                  <Label htmlFor="member-ref-razorpay">Member ID / Member Code (optional)</Label>
                  <Input
                    id="member-ref-razorpay"
                    value={memberRef || ""}
                    onChange={(e) => onMemberRefChange?.(e.target.value)}
                    placeholder="e.g. MTH-123456 or member UUID"
                    data-testid="guest-member-ref-input-razorpay"
                    className="mt-1.5 h-11 font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Leave blank for plain guest purchase. Provide Member ID/Code only if reward percentage attribution is needed.
                  </p>
                </div>
              ) : null}

              {!existingOrderId && requiresServiceSlot ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-3">
                  <p className="text-[11px] font-semibold text-amber-900">Service Slot Details</p>
                  <div>
                    <Label htmlFor="restaurant-slot-time-razorpay">Slot Date & Time <span className="text-red-500">*</span></Label>
                    <Input
                      id="restaurant-slot-time-razorpay"
                      type="datetime-local"
                      value={slotDateTime}
                      onChange={(e) => setSlotDateTime(e.target.value)}
                      className="mt-1.5 h-11"
                      data-testid="restaurant-slot-datetime-razorpay"
                    />
                  </div>
                  {requiresRestaurantSlot ? (
                  <div>
                    <Label htmlFor="restaurant-slot-guests-razorpay">Guest Count <span className="text-red-500">*</span></Label>
                    <Input
                      id="restaurant-slot-guests-razorpay"
                      type="number"
                      min="1"
                      step="1"
                      value={slotGuestCount}
                      onChange={(e) => setSlotGuestCount(e.target.value)}
                      className="mt-1.5 h-11"
                      data-testid="restaurant-slot-guests-razorpay"
                    />
                  </div>
                  ) : null}
                </div>
              ) : null}

              {!existingOrderId && requiresShippingAddress ? (
                <div>
                  <Label htmlFor="ship-razorpay">Shipping Address <span className="text-red-500">*</span></Label>
                  <Textarea
                    id="ship-razorpay"
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Full address with pincode..."
                    data-testid="razorpay-shipping-input"
                    className="mt-1.5 min-h-[70px]"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Shipping address is required before opening Razorpay checkout.
                  </p>
                </div>
              ) : null}

              <div>
                <Label htmlFor="payer-phone-razorpay">Mobile Number</Label>
                <Input
                  id="payer-phone-razorpay"
                  value={payerPhone}
                  onChange={(e) => setPayerPhone(e.target.value)}
                  placeholder="e.g. 98XXXXXXXX"
                  data-testid="razorpay-phone-input"
                  className="mt-1.5 h-11"
                />
              </div>

              <div>
                <Label htmlFor="payer-razorpay">Payer Name (optional)</Label>
                <Input
                  id="payer-razorpay"
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  placeholder="If payment is made from a different account"
                  data-testid="razorpay-payer-input"
                  className="mt-1.5 h-11"
                />
              </div>
            </div>
          )}

          <DialogFooter className={manualUpiEnabled ? "md:col-span-2" : ""}>
            <div className="w-full space-y-2">
              <Button
                type="button"
                variant="outline"
                onClick={goBackToCart}
                className="w-full h-11 rounded-full border-emerald-300 text-emerald-900 hover:bg-emerald-50"
                data-testid="upi-back-to-cart-button"
              >
                Back to Cart
              </Button>
              {razorpayEnabled && !forceManualUpiFlow ? (
                <Button
                  type="button"
                  disabled={submitting || uploading || paymentMode === "cod"}
                  onClick={submitRazorpay}
                  className="w-full h-12 bg-blue-700 hover:bg-blue-800 text-white rounded-full font-semibold"
                  data-testid="razorpay-submit-button"
                >
                  {submitting ? "Opening Razorpay..." : `Pay Now with Razorpay · ₹${total.toLocaleString("en-IN")}`}
                </Button>
              ) : null}
              {manualUpiEnabled ? (
                <>
                  <Button
                    type="submit"
                    disabled={submitting || uploading}
                    className="w-full h-12 bg-emerald-900 hover:bg-emerald-950 text-white rounded-full font-semibold"
                    data-testid="upi-submit-button"
                  >
                    {submitting
                      ? "Submitting..."
                      : (paymentMode === "cod"
                        ? `Place COD Order · ₹${total.toLocaleString("en-IN")}`
                        : `Submit UPI Proof · ₹${total.toLocaleString("en-IN")}`)}
                  </Button>
                  {razorpayEnabled ? (
                    <p className="text-[11px] text-slate-600 text-center">Razorpay online payment enabled. You can still use manual UPI proof flow below.</p>
                  ) : (
                    <p className="text-[11px] text-slate-500 text-center">Razorpay disabled. Manual UPI proof flow is active.</p>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-slate-500 text-center">
                  {razorpayEnabled
                    ? "Manual UPI proof flow is disabled in settings."
                    : "Manual UPI proof flow is disabled in settings. Enable UPI flow for partner payments."}
                </p>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


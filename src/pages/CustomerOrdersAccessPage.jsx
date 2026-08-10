import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2, MessageSquareLock, Package, FileText, UserPlus } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/contexts/SettingsContext";

const CUSTOMER_ACCESS_TOKEN_KEY = "metho_customer_mobile_access_token_v1";
const CUSTOMER_ACCESS_PHONE_KEY = "metho_customer_mobile_access_phone_v1";

const STATUS = {
  pending_payment: { c: "bg-slate-100 text-slate-700", t: "Payment Pending" },
  pending_approval: { c: "bg-amber-100 text-amber-800", t: "Awaiting Approval" },
  paid: { c: "bg-emerald-100 text-emerald-800", t: "Approved & Paid" },
  rejected: { c: "bg-red-100 text-red-700", t: "Rejected" },
  pending: { c: "bg-amber-100 text-amber-800", t: "Pending" },
  delivered: { c: "bg-emerald-100 text-emerald-800", t: "Delivered" },
  cancelled: { c: "bg-red-100 text-red-800", t: "Cancelled" },
};

const normalizePhone = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
};

export default function CustomerOrdersAccessPage() {
  const { settings } = useSettings();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [token, setToken] = useState("");
  const [awaitingOtp, setAwaitingOtp] = useState(false);
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [debugOtp, setDebugOtp] = useState("");

  const mode = String(settings?.customer_mobile_access_mode || "mobile_only").trim().toLowerCase();
  const accessEnabled = settings?.customer_mobile_order_access_enabled !== false;
  const otpMode = mode === "mobile_otp";

  const latestOrder = useMemo(() => (Array.isArray(orders) && orders.length > 0 ? orders[0] : null), [orders]);

  const loadOrders = async (accessToken) => {
    if (!accessToken) return;
    setLoadingOrders(true);
    try {
      const { data } = await api.get("/customer/mobile-access/orders", {
        params: { token: accessToken },
      });
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      setOrders([]);
      const status = Number(err?.response?.status || 0);
      if (status === 401) {
        setToken("");
        try {
          window.sessionStorage.removeItem(CUSTOMER_ACCESS_TOKEN_KEY);
        } catch {}
      }
      toast.error(err?.response?.data?.detail || "Could not load order history");
    } finally {
      setLoadingOrders(false);
    }
  };

  useEffect(() => {
    try {
      const savedPhone = window.sessionStorage.getItem(CUSTOMER_ACCESS_PHONE_KEY) || "";
      const savedToken = window.sessionStorage.getItem(CUSTOMER_ACCESS_TOKEN_KEY) || "";
      if (savedPhone) setPhone(savedPhone);
      if (savedToken) {
        setToken(savedToken);
        loadOrders(savedToken);
      }
    } catch {}
  }, []);

  const persistSession = (normalizedPhone, accessToken) => {
    setToken(accessToken);
    setAwaitingOtp(false);
    setOtp("");
    setDebugOtp("");
    try {
      window.sessionStorage.setItem(CUSTOMER_ACCESS_PHONE_KEY, normalizedPhone);
      window.sessionStorage.setItem(CUSTOMER_ACCESS_TOKEN_KEY, accessToken);
    } catch {}
  };

  const startAccess = async (e) => {
    e.preventDefault();
    if (!accessEnabled) {
      toast.error("Customer mobile access is currently disabled by admin");
      return;
    }
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.length !== 10) {
      toast.error("Enter a valid 10-digit mobile number");
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post("/customer/mobile-access/start", { phone: normalizedPhone });
      if (data?.no_orders) {
        setToken("");
        setOrders([]);
        setAwaitingOtp(false);
        setOtp("");
        setDebugOtp("");
        try {
          window.sessionStorage.removeItem(CUSTOMER_ACCESS_TOKEN_KEY);
          window.sessionStorage.setItem(CUSTOMER_ACCESS_PHONE_KEY, normalizedPhone);
        } catch {}
        toast.error(String(data?.message || "No orders found for this mobile number"));
        return;
      }
      const accessToken = String(data?.access_token || "").trim();
      if (accessToken) {
        persistSession(normalizedPhone, accessToken);
        await loadOrders(accessToken);
        toast.success("Order history unlocked");
        return;
      }
      if (data?.requires_otp) {
        setAwaitingOtp(true);
        setDebugOtp(String(data?.debug_otp || ""));
        toast.success("OTP requested. Enter OTP to continue.");
        return;
      }
      toast.error("Could not start access. Please try again.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not start access");
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.length !== 10) {
      toast.error("Enter a valid 10-digit mobile number");
      return;
    }
    if (!String(otp || "").trim()) {
      toast.error("OTP is required");
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post("/customer/mobile-access/verify", {
        phone: normalizedPhone,
        otp: String(otp || "").trim(),
      });
      const accessToken = String(data?.access_token || "").trim();
      if (!accessToken) {
        toast.error("OTP verification failed");
        return;
      }
      persistSession(normalizedPhone, accessToken);
      await loadOrders(accessToken);
      toast.success("OTP verified. Order history unlocked.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "OTP verification failed");
    } finally {
      setBusy(false);
    }
  };

  const logoutAccess = () => {
    setToken("");
    setOrders([]);
    setAwaitingOtp(false);
    setOtp("");
    setDebugOtp("");
    try {
      window.sessionStorage.removeItem(CUSTOMER_ACCESS_TOKEN_KEY);
    } catch {}
  };

  const openRegister = (order) => {
    const normalizedPhone = normalizePhone(phone);
    const prefillName = String(order?.payer_name || latestOrder?.payer_name || "").trim();
    const qs = new URLSearchParams();
    if (prefillName) qs.set("prefill_name", prefillName);
    if (normalizedPhone) qs.set("prefill_phone", normalizedPhone);
    window.location.href = `/register${qs.toString() ? `?${qs.toString()}` : ""}`;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="inline-flex items-center text-sm font-semibold text-emerald-900 hover:underline">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Home
          </Link>
          {token ? (
            <Button type="button" variant="outline" className="rounded-full" onClick={logoutAccess}>
              Sign Out
            </Button>
          ) : null}
        </div>

        <div className="bg-white rounded-xl border border-border p-6" data-testid="customer-mobile-access-card">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
              <MessageSquareLock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display font-black text-2xl text-emerald-950">Customer Mobile Order History</h1>
              <p className="text-sm text-slate-600 mt-1">Enter your mobile number to see past orders and continue as a member anytime.</p>
            </div>
          </div>

          {!accessEnabled ? (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Customer mobile access is disabled by admin right now.
            </div>
          ) : (
            <form onSubmit={startAccess} className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
              <div>
                <Label htmlFor="customer-mobile-input">Mobile Number</Label>
                <Input
                  id="customer-mobile-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 98XXXXXXXX"
                  className="mt-1.5 h-11"
                  data-testid="customer-mobile-input"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {otpMode ? "OTP verification may be required based on admin settings." : "Mobile-only quick entry is currently active."}
                </p>
              </div>
              <Button
                type="submit"
                disabled={busy}
                className="self-end h-11 rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
                data-testid="customer-mobile-start"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
              </Button>
            </form>
          )}

          {awaitingOtp ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4" data-testid="customer-otp-wrap">
              <Label htmlFor="customer-otp-input">OTP</Label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Input
                  id="customer-otp-input"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="Enter OTP"
                  className="h-11 max-w-[220px]"
                  data-testid="customer-otp-input"
                />
                <Button
                  type="button"
                  onClick={verifyOtp}
                  disabled={busy}
                  className="h-11 rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
                  data-testid="customer-otp-verify"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify OTP"}
                </Button>
              </div>
              {debugOtp ? (
                <p className="mt-2 text-xs text-amber-800" data-testid="customer-otp-debug">Test OTP: {debugOtp}</p>
              ) : null}
            </div>
          ) : null}

          {token ? (
            <div className="mt-5 flex flex-wrap gap-2" data-testid="customer-member-cta-wrap">
              <Button
                type="button"
                onClick={() => openRegister(latestOrder)}
                className="rounded-full bg-amber-400 hover:bg-amber-500 text-emerald-950"
                data-testid="customer-add-to-member"
              >
                <UserPlus className="w-4 h-4 mr-2" /> Add to Member
              </Button>
              <Link to="/login">
                <Button type="button" variant="outline" className="rounded-full" data-testid="customer-login-member-link">
                  Member Login
                </Button>
              </Link>
            </div>
          ) : null}
        </div>

        <div className="space-y-4" data-testid="customer-orders-list">
          {loadingOrders ? (
            <div className="bg-white rounded-xl border border-border p-8 text-center text-slate-600">
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              <p className="mt-2 text-sm">Loading your order history...</p>
            </div>
          ) : null}

          {!loadingOrders && token && orders.length === 0 ? (
            <div className="bg-white rounded-xl border border-border p-8 text-center">
              <Package className="w-9 h-9 text-slate-400 mx-auto" />
              <p className="mt-3 text-sm text-muted-foreground">No orders found for this mobile number.</p>
            </div>
          ) : null}

          {!loadingOrders && orders.map((o, idx) => {
            const st = STATUS[o.status] || STATUS.pending;
            return (
              <div key={o.id} className="bg-white rounded-xl border border-border p-5" data-testid={`customer-order-${idx}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.15em] text-emerald-800 font-semibold">{o.order_no}</p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(o.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${st.c}`}>{st.t}</span>
                    <p className="font-display font-black text-xl text-emerald-950">₹{Number(o.total_amount || 0).toLocaleString("en-IN")}</p>
                  </div>
                </div>

                <div className="mt-3 divide-y divide-border border-t border-border">
                  {(o.items || []).map((it, itemIdx) => (
                    <div key={`${o.id}-${itemIdx}`} className="py-2 flex justify-between text-sm">
                      <span className="text-slate-700">{it.product_name || "Item"} x {it.quantity}</span>
                      <span className="font-semibold">₹{Number(it.subtotal || 0).toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap justify-between text-xs text-muted-foreground gap-2">
                  <span>METHO ₹{Number(o.metho_amount || 0).toLocaleString("en-IN")} · Partner ₹{Number(o.associate_amount || 0).toLocaleString("en-IN")}</span>
                  <span>{o.shipping_address ? `Ship to: ${o.shipping_address}` : "Service / no shipping address"}</span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openRegister(o)}
                    className="rounded-full"
                    data-testid={`customer-order-add-member-${idx}`}
                  >
                    <UserPlus className="w-4 h-4 mr-1" /> Add to Member
                  </Button>
                  <Link to={`/customer-invoice/${o.id}?token=${encodeURIComponent(token)}`}>
                    <Button type="button" variant="outline" className="rounded-full" data-testid={`customer-order-login-${idx}`}>
                      <FileText className="w-4 h-4 mr-1" /> View Invoice
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import api from "@/services/api";

const geocodeAddress = async (address) => {
  const query = String(address || "").trim();
  if (!query) return null;
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const rows = await response.json();
  const first = Array.isArray(rows) ? rows[0] : null;
  if (!first) return null;
  const latitude = Number(first.lat);
  const longitude = Number(first.lon);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
};

const findRoadDistanceKm = async (pickup, destination) => {
  const [origin, target] = await Promise.all([geocodeAddress(pickup), geocodeAddress(destination)]);
  if (!origin || !target) return 0;
  const route = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${target.longitude},${target.latitude}?overview=false&alternatives=true`);
  if (!route.ok) return 0;
  const payload = await route.json();
  const distances = Array.isArray(payload?.routes)
    ? payload.routes.map((item) => Number(item.distance || 0) / 1000).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  return distances.length ? Math.max(...distances) : 0;
};

const loadRazorpay = () => new Promise((resolve) => {
  if (window.Razorpay) return resolve(true);
  const script = document.createElement("script");
  script.src = "https://checkout.razorpay.com/v1/checkout.js";
  script.onload = () => resolve(true);
  script.onerror = () => resolve(false);
  document.body.appendChild(script);
});

export default function MethoMovePage() {
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({ service_type: searchParams.get("service") === "delivery" ? "delivery" : "ebike", pickup: "", destination: "", customer_name: "", customer_phone: "", member_ref: "", distance_km: 1 });
  const [booking, setBooking] = useState(null);
  const [rates, setRates] = useState({ bike: 12, e_rickshaw: 16, auto_rickshaw: 20, delivery: 14 });
  const [roadDistanceKm, setRoadDistanceKm] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  useEffect(() => {
    if (!booking?.id || !booking?.access_token || ["paid", "completed"].includes(booking.status)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const { data } = await api.get(`/metho-move/bookings/${booking.id}`, { params: { access_token: booking.access_token } });
        if (data?.booking) setBooking(data.booking);
      } catch {}
    }, 5000);
    return () => window.clearInterval(timer);
  }, [booking?.id, booking?.access_token, booking?.status]);

  const payForBooking = async () => {
    if (!booking) return;
    setLoading(true);
    try {
      const sdkLoaded = await loadRazorpay();
      if (!sdkLoaded) throw new Error("Razorpay SDK failed to load");
      const { data: order } = await api.post(`/metho-move/bookings/${booking.id}/razorpay/order`);
      const checkout = new window.Razorpay({
        key: order.key_id, amount: order.amount, currency: order.currency, name: order.name,
        order_id: order.razorpay_order_id, description: "METHO Move booking",
        prefill: { name: form.customer_name, contact: form.customer_phone }, theme: { color: "#065f46" },
        handler: async (response) => {
          try {
            const verified = await api.post(`/metho-move/bookings/${booking.id}/razorpay/verify`, { ...response, amount: booking.amount });
            setBooking(verified.data.booking);
            toast.success("METHO booking payment verified");
          } catch (error) { toast.error(error?.response?.data?.detail || "Payment verification failed"); }
        },
        modal: { ondismiss: () => setLoading(false) },
      });
      checkout.open();
    } catch (error) { toast.error(error?.response?.data?.detail || error.message || "Payment could not be started"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    api.get("/settings/public").then(({ data }) => setRates((current) => ({ ...current, ...(data?.metho_transport_rates || {}) }))).catch(() => {});
  }, []);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const rateKey = form.service_type === "ebike" ? "bike" : form.service_type;
  const amount = roadDistanceKm > 0 ? roadDistanceKm * Number(rates[rateKey] || 0) : 0;

  useEffect(() => {
    const pickup = String(form.pickup || "").trim();
    const destination = String(form.destination || "").trim();
    if (!pickup || !destination) {
      setRoadDistanceKm(0);
      return undefined;
    }
    let cancelled = false;
    setRouteLoading(true);
    findRoadDistanceKm(pickup, destination)
      .then((distance) => { if (!cancelled) setRoadDistanceKm(distance); })
      .catch(() => { if (!cancelled) setRoadDistanceKm(0); })
      .finally(() => { if (!cancelled) setRouteLoading(false); });
    return () => { cancelled = true; };
  }, [form.pickup, form.destination]);

  const submit = async (event) => {
    event.preventDefault();
    if (!termsAccepted) {
      toast.error("Please read and accept the METHO Move Customer Terms & Conditions");
      return;
    }
    setLoading(true);
    try {
      if (!roadDistanceKm) throw new Error("Road distance could not be calculated. Enter complete pickup and destination addresses.");
      const { data } = await api.post("/metho-move/bookings", { ...form, distance_km: Number(roadDistanceKm.toFixed(2)), request_assignment: true });
      setBooking(data.booking);
      toast.success("Nearest driver খোঁজা হচ্ছে। Driver accept করলে payment button আসবে।");
    } catch (error) {
      toast.error(error?.response?.data?.detail || error.message || "Booking could not be created");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-secondary/30 px-6 py-10" data-testid="metho-move-page">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-800">METHO Move / METHO Delivery</p>
          <h1 className="mt-2 font-display text-4xl font-black text-emerald-950">Book direct METHO mobility or delivery</h1>
          <p className="mt-2 text-slate-600">Choose a METHO service, enter the route, and pay securely through Razorpay.</p>
        </div>
        <form onSubmit={submit} className="grid gap-4 rounded-xl bg-white p-6 shadow-sm sm:grid-cols-2">
          <div><Label htmlFor="metho-service-type">METHO service</Label><select id="metho-service-type" value={form.service_type} onChange={(event) => update("service_type", event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-white px-3 text-sm"><option value="ebike">E-bike</option><option value="e_rickshaw">E-rickshaw</option><option value="auto_rickshaw">Auto-rickshaw</option><option value="delivery">METHO Delivery</option></select></div>
          <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm"><p className="text-xs font-semibold text-cyan-900">Map road distance</p><p className="mt-1 font-bold text-emerald-950">{routeLoading ? "Calculating route..." : roadDistanceKm ? `${roadDistanceKm.toFixed(1)} km` : "Enter pickup and destination"}</p></div>
          <div><Label htmlFor="metho-pickup">Pickup</Label><Input id="metho-pickup" required value={form.pickup} onChange={(event) => update("pickup", event.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="metho-destination">Destination</Label><Input id="metho-destination" required value={form.destination} onChange={(event) => update("destination", event.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="metho-customer-name">Customer name</Label><Input id="metho-customer-name" required value={form.customer_name} onChange={(event) => update("customer_name", event.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="metho-customer-phone">Mobile / WhatsApp</Label><Input id="metho-customer-phone" required value={form.customer_phone} onChange={(event) => update("customer_phone", event.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="metho-member-ref">Member ID (optional)</Label><Input id="metho-member-ref" value={form.member_ref} onChange={(event) => update("member_ref", event.target.value)} className="mt-1.5" /></div>
          <label className="sm:col-span-2 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-950" data-testid="metho-move-terms-consent"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" data-testid="metho-move-terms-checkbox" /><span>I have read and accept the <Link to="/metho-move-terms" target="_blank" rel="noreferrer" className="font-semibold underline">METHO Move Customer Terms &amp; Conditions</Link>, including METHO Move&apos;s intermediary role and my responsibilities as a customer.</span></label>
          <div className="sm:col-span-2 flex items-end justify-between gap-3"><div><p className="text-xs text-slate-500">Estimated amount</p><p className="text-2xl font-black text-emerald-950">{amount ? `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "Route required"}</p></div><Button type="submit" disabled={loading || routeLoading || !roadDistanceKm || !termsAccepted} className="rounded-full bg-emerald-900 hover:bg-emerald-950" data-testid="metho-move-submit">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Pay &amp; book <ArrowRight className="ml-2 h-4 w-4" /></>}</Button></div>
        </form>
        {booking ? <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-center gap-2"><MapPin className="h-5 w-5 text-emerald-800" /><h2 className="font-bold text-emerald-950">Booking status: {booking.status}</h2></div><p className="mt-2 text-sm text-slate-700">Reference {booking.id}</p>{booking.booking_code ? <p className="mt-1 text-sm font-semibold text-emerald-900">Booking code: {booking.booking_code}</p> : null}{booking.status === "accepted" ? <Button type="button" onClick={payForBooking} disabled={loading} className="mt-4 rounded-full bg-emerald-900 hover:bg-emerald-950">Pay securely and confirm</Button> : null}</section> : null}
      </div>
    </main>
  );
}

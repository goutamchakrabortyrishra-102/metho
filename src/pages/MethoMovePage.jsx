import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import api from "@/services/api";

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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get("/settings/public").then(({ data }) => setRates((current) => ({ ...current, ...(data?.metho_transport_rates || {}) }))).catch(() => {});
  }, []);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const rateKey = form.service_type === "ebike" ? "bike" : form.service_type;
  const amount = Math.max(1, Number(form.distance_km) || 1) * Number(rates[rateKey] || 0);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/metho-move/bookings", { ...form, distance_km: Number(form.distance_km) || 1, request_assignment: true });
      const created = data.booking;
      const sdkLoaded = await loadRazorpay();
      if (!sdkLoaded) throw new Error("Razorpay SDK failed to load");
      const { data: order } = await api.post(`/metho-move/bookings/${created.id}/razorpay/order`);
      setBooking(created);
      const checkout = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        order_id: order.razorpay_order_id,
        description: form.service_type === "delivery" ? "METHO Delivery booking" : "METHO Move booking",
        prefill: { name: form.customer_name, contact: form.customer_phone },
        theme: { color: "#065f46" },
        handler: async (response) => {
          try {
            const verified = await api.post(`/metho-move/bookings/${created.id}/razorpay/verify`, { ...response, amount: created.amount });
            setBooking(verified.data.booking);
            toast.success("METHO booking payment verified");
          } catch (error) {
            toast.error(error?.response?.data?.detail || "Payment verification failed");
          }
        },
        modal: { ondismiss: () => setLoading(false) },
      });
      checkout.open();
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
          <div><Label htmlFor="metho-distance">Distance (km)</Label><Input id="metho-distance" type="number" min="1" step="0.1" value={form.distance_km} onChange={(event) => update("distance_km", event.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="metho-pickup">Pickup</Label><Input id="metho-pickup" required value={form.pickup} onChange={(event) => update("pickup", event.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="metho-destination">Destination</Label><Input id="metho-destination" required value={form.destination} onChange={(event) => update("destination", event.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="metho-customer-name">Customer name</Label><Input id="metho-customer-name" required value={form.customer_name} onChange={(event) => update("customer_name", event.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="metho-customer-phone">Mobile / WhatsApp</Label><Input id="metho-customer-phone" required value={form.customer_phone} onChange={(event) => update("customer_phone", event.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="metho-member-ref">Member ID (optional)</Label><Input id="metho-member-ref" value={form.member_ref} onChange={(event) => update("member_ref", event.target.value)} className="mt-1.5" /></div>
          <div className="flex items-end justify-between gap-3"><div><p className="text-xs text-slate-500">Estimated amount</p><p className="text-2xl font-black text-emerald-950">₹{amount.toLocaleString("en-IN")}</p></div><Button type="submit" disabled={loading} className="rounded-full bg-emerald-900 hover:bg-emerald-950">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Pay &amp; book <ArrowRight className="ml-2 h-4 w-4" /></>}</Button></div>
        </form>
        {booking ? <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-center gap-2"><MapPin className="h-5 w-5 text-emerald-800" /><h2 className="font-bold text-emerald-950">Booking status: {booking.status}</h2></div><p className="mt-2 text-sm text-slate-700">Reference {booking.id}</p></section> : null}
      </div>
    </main>
  );
}

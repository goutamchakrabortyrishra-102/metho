import React, { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, LogOut, MapPin, Power, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/services/api";

export default function RiderDashboardPage() {
  const { user, logout } = useAuth();
  const [rider, setRider] = useState(null);
  const [availability, setAvailability] = useState("offline");
  const [jobs, setJobs] = useState([]);
  const [partnerDeliveries, setPartnerDeliveries] = useState([]);
  const nav = useNavigate();

  useEffect(() => {
    api.get("/rider/me").then(({ data }) => {
      setRider(data.rider);
      setAvailability(data.rider?.availability || "offline");
    }).catch((error) => toast.error(error?.response?.data?.detail || "Could not load rider profile"));
    loadJobs();
  }, []);

  useEffect(() => {
    if (availability !== "online" || !navigator.geolocation?.watchPosition) return undefined;
    let lastSentAt = 0;
    const watchId = navigator.geolocation.watchPosition(({ coords }) => {
      const now = Date.now();
      if (now - lastSentAt < 30000) return;
      lastSentAt = now;
      api.put("/rider/availability", { availability: "online", latitude: coords.latitude, longitude: coords.longitude }).catch(() => {});
    }, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [availability]);

  const loadJobs = async () => {
    const [moveResult, deliveryResult] = await Promise.all([
      api.get("/rider/metho-move/bookings").catch(() => ({ data: { bookings: [] } })),
      api.get("/rider/partner-deliveries").catch(() => ({ data: { items: [] } })),
    ]);
    setJobs(moveResult.data?.bookings || []);
    setPartnerDeliveries(deliveryResult.data?.items || []);
  };

  const advancePartnerDelivery = async (job, status) => {
    try {
      await api.post(`/rider/partner-deliveries/${job.id}/status`, { status });
      toast.success(`Delivery marked ${status.replaceAll("_", " ")}`);
      loadJobs();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update delivery");
    }
  };

  const confirmPartnerPayment = async (job) => {
    try {
      await api.post(`/rider/partner-deliveries/${job.id}/payment`);
      toast.success("Partner cash payment confirmed");
      loadJobs();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not confirm payment");
    }
  };

  const toggleAvailability = async () => {
    const next = availability === "online" ? "offline" : "online";
    try {
      const position = await new Promise((resolve) => navigator.geolocation?.getCurrentPosition((value) => resolve(value.coords), () => resolve(null)) || resolve(null));
      await api.put("/rider/availability", { availability: next, latitude: position?.latitude, longitude: position?.longitude });
      setAvailability(next);
      toast.success(`You are now ${next}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update availability");
    }
  };

  const signOut = () => { logout(); nav("/"); };

  const pickupMapUrl = (job) => {
    const latitude = Number(job?.pickup_latitude);
    const longitude = Number(job?.pickup_longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  };

  return (
    <main className="min-h-screen bg-secondary/30 p-6 md:p-10" data-testid="rider-dashboard">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div><p className="text-sm text-emerald-800">METHO Rider</p><h1 className="font-display font-black text-3xl text-emerald-950">Welcome, {user?.name || rider?.name}</h1></div>
          <Button variant="outline" onClick={signOut}><LogOut className="mr-2 h-4 w-4" /> Sign out</Button>
        </div>
        <section className="rounded-xl bg-white p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between gap-4"><h2 className="font-display text-xl font-bold text-emerald-950">Availability</h2><span className="capitalize text-sm text-muted-foreground">{availability}</span></div>
          <Button onClick={toggleAvailability} className="rounded-full bg-emerald-900 hover:bg-emerald-950"><Power className="mr-2 h-4 w-4" /> Go {availability === "online" ? "offline" : "online"}</Button>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <p><strong>Vehicle:</strong> {rider?.vehicle_type || "-"}</p>
            <p><strong>Number:</strong> {rider?.vehicle_number || "-"}</p>
            <p><strong>Phone:</strong> {rider?.phone || "-"}</p>
            <p><strong>Status:</strong> {rider?.approval_status || "approved"}</p>
          </div>
        </section>
        <section className="mt-6 rounded-xl bg-white p-6 shadow-sm"><div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-bold text-emerald-950">Assigned METHO Move jobs</h2><Button variant="outline" size="sm" onClick={loadJobs}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button></div><div className="mt-4 grid gap-3">{jobs.length ? jobs.map((job) => <div key={job.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-emerald-950">{job.service_type} · {job.status}</p><p className="text-sm text-slate-600">{job.pickup} → {job.destination}</p><p className="text-xs text-slate-500">{job.customer_name} · {job.customer_phone}</p>{pickupMapUrl(job) ? <a href={pickupMapUrl(job)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950"><MapPin className="h-3.5 w-3.5" />Open pickup map <ExternalLink className="h-3 w-3" /></a> : <p className="mt-2 text-xs text-amber-700">Pickup map unavailable; use the customer address above.</p>}</div><div className="flex gap-2">{["assigned", "awaiting_driver_assignment"].includes(job.status) ? <><Button size="sm" onClick={async () => { await api.post(`/rider/metho-move/bookings/${job.id}/accept`); loadJobs(); }}><CheckCircle2 className="mr-1 h-4 w-4" /> Accept</Button><Button size="sm" variant="outline" onClick={async () => { await api.post(`/rider/metho-move/bookings/${job.id}/reject`); loadJobs(); }}>Reject</Button></> : null}{["accepted", "assigned", "paid"].includes(job.status) ? <Button size="sm" variant="outline" onClick={async () => { await api.post(`/rider/metho-move/bookings/${job.id}/complete`, {}); loadJobs(); }}>Complete</Button> : null}</div></div></div>) : <p className="text-sm text-slate-500">No assigned jobs.</p>}</div></section>
        <section className="mt-6 rounded-xl bg-white p-6 shadow-sm" data-testid="partner-delivery-jobs"><div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-bold text-emerald-950">Partner product deliveries</h2><Button variant="outline" size="sm" onClick={loadJobs}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button></div><div className="mt-4 grid gap-3">{partnerDeliveries.length ? partnerDeliveries.map((job) => {
          const nextStatus = { assigned: "accepted", accepted: "picked_up", picked_up: "out_for_delivery", out_for_delivery: "delivered" }[job.status];
          const actionLabel = { assigned: "Accept delivery", accepted: "Mark picked up", picked_up: "Out for delivery", out_for_delivery: "Mark delivered" }[job.status];
          const dropUrl = Number.isFinite(Number(job.drop_latitude)) && Number.isFinite(Number(job.drop_longitude)) ? `https://www.google.com/maps/search/?api=1&query=${job.drop_latitude},${job.drop_longitude}` : "";
          return <article key={job.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-emerald-950">{job.order_no} · {job.status.replaceAll("_", " ")}</p><p className="text-sm text-slate-700">Partner: {job.partner_name} · Customer: {job.customer_name} · {job.customer_phone || "No customer phone"}</p><p className="text-xs text-slate-500">{job.customer_address} · {job.distance_km} km · Earning ₹{Number(job.rider_earning).toFixed(2)}</p>{dropUrl ? <a href={dropUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-800 underline"><MapPin className="h-3.5 w-3.5" />Open delivery map</a> : null}<p className="mt-1 text-xs text-amber-700">Partner fee: ₹{Number(job.partner_charge).toFixed(2)} · {job.partner_payment_status.replaceAll("_", " ")}</p></div><div className="flex flex-wrap gap-2">{nextStatus ? <Button size="sm" onClick={() => advancePartnerDelivery(job, nextStatus)}>{actionLabel}</Button> : null}{job.status === "delivered" && job.partner_payment_status === "partner_confirmed" ? <Button size="sm" variant="outline" onClick={() => confirmPartnerPayment(job)}>Confirm cash received</Button> : null}</div></div></article>;
        }) : <p className="text-sm text-slate-500">No partner product deliveries assigned.</p>}</div></section>
      </div>
    </main>
  );
}
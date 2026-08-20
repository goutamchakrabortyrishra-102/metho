import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, MapPin, RefreshCw, Truck } from "lucide-react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const ADMIN_ROLES = ["super_admin", "company_admin", "admin"];
const normalize = (value) => String(value || "").toLowerCase();
const isCourier = (item) => /courier|logistics|parcel|delivery|cargo/i.test([item.business_type, item.business_name, item.notes, item.business_description].join(" "));
const liveLocationUrl = (location) => {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
};

export default function AdminServiceSectorsPage() {
  const { user } = useAuth();
  const isAdmin = user && ADMIN_ROLES.includes(user.role);
  const [partners, setPartners] = useState([]);
  const [orders, setOrders] = useState([]);
  const [deliveryTrips, setDeliveryTrips] = useState([]);
  const [deliveryDrivers, setDeliveryDrivers] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [partnerResponse, orderResponse, deliveryResponse, driverResponse] = await Promise.all([
        api.get("/admin/partners"),
        api.get("/admin/orders/pending"),
        api.get("/admin/delivery/bookings"),
        api.get("/admin/drivers"),
      ]);
      setPartners(Array.isArray(partnerResponse.data) ? partnerResponse.data : []);
      setOrders(Array.isArray(orderResponse.data) ? orderResponse.data : []);
      setDeliveryTrips(Array.isArray(deliveryResponse.data?.items) ? deliveryResponse.data.items : []);
      setDeliveryDrivers(Array.isArray(driverResponse.data) ? driverResponse.data.filter((driver) => driver.approval_status === "approved" && driver.active && driver.service_sector === "delivery") : []);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to load service sector controls");
      setPartners([]);
      setOrders([]);
      setDeliveryTrips([]);
      setDeliveryDrivers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);
  useEffect(() => {
    if (!isAdmin) return undefined;
    const intervalId = window.setInterval(load, 10000);
    return () => window.clearInterval(intervalId);
  }, [isAdmin, load]);
  const filteredPartners = useMemo(() => partners.filter(isCourier), [partners]);
  const filteredOrders = useMemo(() => orders.filter((order) => {
    const text = normalize(JSON.stringify(order));
    return /courier|logistics|parcel|delivery|cargo/.test(text);
  }), [orders]);

  const assignDeliveryDriver = async (tripId, driverId) => {
    if (!driverId) return;
    try {
      await api.post(`/admin/delivery/bookings/${tripId}/assign-driver`, { driver_id: driverId });
      toast.success("Delivery agent assigned");
      load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Delivery agent assignment failed");
    }
  };

  if (!isAdmin) return <Navigate to="/app" replace />;
  const title = "Courier / Logistics Control";
  const subtitle = "Monitor courier, logistics, parcel and delivery partners from listing to live delivery.";

  return <div className="space-y-6" data-testid="admin-service-sectors-page">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p><h1 className="font-display font-black text-3xl text-emerald-950 mt-1 flex items-center gap-2"><BriefcaseBusiness className="w-8 h-8" /> {title}</h1><p className="text-sm text-slate-600 mt-1">{subtitle}</p></div>
      <Button variant="outline" className="rounded-full" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
    </div>
    <a href="/app/active-tracking?sector=delivery" className="inline-flex rounded-full border border-cyan-300 px-4 py-2 text-sm font-semibold text-cyan-900">Active Delivery Agents / Live Tracking</a>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><div className="rounded-xl border bg-white p-4"><p className="text-xs uppercase text-slate-500">Delivery Partners</p><p className="text-3xl font-black text-emerald-950">{filteredPartners.length}</p></div><div className="rounded-xl border bg-white p-4"><p className="text-xs uppercase text-slate-500">Pending Orders</p><p className="text-3xl font-black text-amber-700">{filteredOrders.length}</p></div><div className="rounded-xl border bg-white p-4"><p className="text-xs uppercase text-slate-500">Active Agents</p><p className="text-3xl font-black text-cyan-800">{deliveryDrivers.length}</p></div></div>
    <section className="rounded-xl border bg-white p-5"><h2 className="font-display font-bold text-lg text-emerald-950">Courier / Logistics Partners</h2>{filteredPartners.length === 0 ? <p className="mt-4 text-sm text-slate-500">No delivery partners found.</p> : <div className="mt-4 grid gap-3">{filteredPartners.map((partner) => <div key={partner.id} className="rounded-lg border p-4 flex flex-wrap justify-between gap-3"><div><p className="font-semibold text-emerald-950">{partner.business_name}</p><p className="text-xs text-slate-600">{partner.partner_code} · {partner.business_type}</p></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${partner.active === false ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{partner.active === false ? "Inactive" : "Active"}</span></div>)}</div>}</section>
    <section className="rounded-xl border bg-white p-5"><h2 className="font-display font-bold text-lg text-emerald-950">Related Pending Orders</h2>{filteredOrders.length === 0 ? <p className="mt-4 text-sm text-slate-500">No related pending orders.</p> : <div className="mt-4 grid gap-3">{filteredOrders.map((order) => <div key={order.id} className="rounded-lg border p-4 flex justify-between gap-3"><div><p className="font-mono text-xs text-emerald-800">{order.order_no || order.id}</p><p className="text-sm text-slate-700">{order.user_name || order.payer_name || "Customer"}</p></div><span className="text-sm font-semibold text-emerald-900">INR {Number(order.total_amount || 0).toLocaleString("en-IN")}</span></div>)}</div>}</section>
    <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-display font-bold text-lg text-emerald-950">Live Delivery Tracking</h2><p className="text-xs text-slate-600 mt-1">Partner-shared GPS snapshots from active delivery bookings.</p></div><span className="text-xs font-semibold text-cyan-900">{deliveryTrips.length} bookings</span></div>{deliveryTrips.length === 0 ? <p className="mt-4 text-sm text-slate-500">No delivery bookings found.</p> : <div className="mt-4 grid gap-3">{deliveryTrips.map((trip) => <div key={trip.id} className="rounded-lg border border-cyan-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-xs text-cyan-800">{trip.trip_code || trip.id}</p><p className="font-semibold text-emerald-950 mt-1">{trip.business_name || trip.partner_code || "Delivery Partner"}</p><p className="text-xs text-slate-600 mt-1">{trip.pickup || "Pickup"} → {trip.destination || "Destination"}</p><select value={trip.driver_id || ""} onChange={(e) => assignDeliveryDriver(trip.id, e.target.value)} className="mt-2 h-9 w-full max-w-xs rounded-md border border-cyan-200 bg-white px-2 text-xs"><option value="">{trip.driver?.name ? `Assigned: ${trip.driver.name}` : "Assign approved delivery agent"}</option>{deliveryDrivers.filter((driver) => String(driver.partner_id) === String(trip.partner_id)).map((driver) => <option key={driver.id} value={driver.id}>{driver.name} · {driver.vehicle_number || driver.vehicle_type || "Agent"}</option>)}</select></div><div className="text-right">{trip.live_location ? <a href={liveLocationUrl(trip.live_location)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-800 underline"><MapPin className="w-3 h-3" /> Open last GPS</a> : <span className="text-xs text-slate-500">No GPS update yet</span>}<p className="text-[10px] uppercase text-slate-500 mt-1">{trip.status || "booked"}</p></div></div>)}</div>}</section>
  </div>;
}

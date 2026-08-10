import React, { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { CarTaxiFront, MapPin, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 3;

const STATUS_COLORS = {
  booked: "bg-amber-100 text-amber-800 border-amber-200",
  confirmed: "bg-sky-100 text-sky-800 border-sky-200",
  on_trip: "bg-emerald-100 text-emerald-900 border-emerald-200",
  completed: "bg-teal-100 text-teal-800 border-teal-200",
  paid: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
};

export default function AdminTransportPage() {
  const { user } = useAuth();
  const isAdmin = user && ["super_admin", "company_admin", "admin"].includes(user.role);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (nextOffset) => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/transport/bookings", {
        params: { offset: nextOffset, limit: PAGE_SIZE },
      });
      setTotal(data.total ?? 0);
      setOffset(nextOffset);
      setItems(data.items ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load transport bookings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load(0);
  }, [isAdmin, load]);

  if (!isAdmin) return <Navigate to="/app" replace />;

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-6" data-testid="admin-transport-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1 flex items-center gap-2">
            <CarTaxiFront className="w-8 h-8" /> Transport Bookings
          </h1>
          <p className="text-sm text-muted-foreground font-body mt-1">
            All ride bookings — pickup, destination, status, and fare at a glance.
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => load(offset)}
          disabled={loading}
          data-testid="admin-transport-refresh"
        >
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
        Total bookings: <span className="font-semibold text-emerald-900">{total}</span>
        {" · "}Showing <span className="font-semibold">{offset + 1}</span>–<span className="font-semibold">{Math.min(offset + PAGE_SIZE, total)}</span>
      </div>

      {items.length === 0 && !loading ? (
        <div className="rounded-xl border border-border bg-white p-10 text-center text-slate-500">
          No transport bookings found.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((trip) => {
            const statusColor = STATUS_COLORS[String(trip.status || "booked")] || "bg-slate-100 text-slate-700 border-slate-200";
            const fare = Number(trip.fare_final || trip.fare_quote || 0);
            return (
              <div
                key={trip.id}
                className="rounded-xl border border-border bg-white p-5"
                data-testid={`admin-trip-${trip.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-mono text-xs text-emerald-800 font-semibold">{trip.trip_code || trip.id}</p>
                    <p className="font-semibold text-emerald-950">{trip.service_name || "Transport Service"}</p>
                    <p className="text-xs text-slate-600">Partner: {trip.business_name || trip.partner_code || "—"}</p>
                    <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 inline-flex flex-col gap-0.5">
                      <p className="text-[11px] font-semibold text-sky-800 uppercase tracking-wider flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Route
                      </p>
                      <p className="text-sm font-semibold text-emerald-950">
                        {trip.pickup || "—"} → {trip.destination || "—"}
                      </p>
                    </div>
                    <p className="text-xs text-slate-700 mt-1">
                      Customer: {trip.customer_name || "—"}
                      {trip.customer_phone ? ` · ${trip.customer_phone}` : ""}
                    </p>
                    {trip.travel_date ? (
                      <p className="text-xs text-slate-600">Schedule: {trip.travel_date}</p>
                    ) : null}
                    {trip.notes ? (
                      <p className="text-xs text-slate-500 italic">Note: {trip.notes}</p>
                    ) : null}
                  </div>
                  <div className="text-right space-y-1">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-semibold ${statusColor}`}>
                      {String(trip.status || "booked").toUpperCase()}
                    </span>
                    <p className="text-sm font-semibold text-emerald-900 mt-1">
                      ₹{fare.toLocaleString("en-IN")}
                      {Number(trip.fare_final || 0) === 0 ? <span className="text-xs font-normal text-slate-500"> (quoted)</span> : <span className="text-xs font-normal text-slate-500"> (final)</span>}
                    </p>
                    {trip.created_at ? (
                      <p className="text-[10px] text-slate-400">{new Date(trip.created_at).toLocaleString()}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          className="rounded-full"
          disabled={!hasPrev || loading}
          onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
          data-testid="admin-transport-prev"
        >
          ← Previous 3
        </Button>
        <Button
          variant="outline"
          className="rounded-full"
          disabled={!hasNext || loading}
          onClick={() => load(offset + PAGE_SIZE)}
          data-testid="admin-transport-next"
        >
          Next 3 →
        </Button>
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Building2, RefreshCw, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 3;

const STATUS_COLORS = {
  pending_approval: "bg-amber-100 text-amber-800 border-amber-200",
  paid: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
};

export default function AdminStayDiningBookingsPage() {
  const { user } = useAuth();
  const isAdmin = user && ["super_admin", "company_admin", "admin"].includes(user.role);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (nextOffset) => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/stay-dining/bookings", {
        params: { offset: nextOffset, limit: PAGE_SIZE },
      });
      setTotal(data.total ?? 0);
      setOffset(nextOffset);
      setItems(data.items ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load stay and dining bookings");
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
    <div className="space-y-6" data-testid="admin-stay-dining-bookings-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1 flex items-center gap-2">
            <UtensilsCrossed className="w-8 h-8" /> Stay & Dining Bookings
          </h1>
          <p className="text-sm text-muted-foreground font-body mt-1">
            Only stay and dining sector bookings with customer, booking address, and partner details.
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => load(offset)}
          disabled={loading}
          data-testid="admin-stay-dining-refresh"
        >
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
        Total bookings: <span className="font-semibold text-emerald-900">{total}</span>
        {" · "}Showing <span className="font-semibold">{total === 0 ? 0 : offset + 1}</span>–<span className="font-semibold">{Math.min(offset + PAGE_SIZE, total)}</span>
      </div>

      {items.length === 0 && !loading ? (
        <div className="rounded-xl border border-border bg-white p-10 text-center text-slate-500">
          No stay and dining bookings found.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((booking) => {
            const statusKey = String(booking?.status || "pending_approval").toLowerCase();
            const statusColor = STATUS_COLORS[statusKey] || "bg-slate-100 text-slate-700 border-slate-200";
            return (
              <div key={booking.id} className="rounded-xl border border-border bg-white p-5" data-testid={`admin-stay-dining-booking-${booking.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-mono text-xs text-emerald-800 font-semibold">{booking.order_no || booking.id}</p>
                    <p className="text-xs text-slate-700">Customer: {booking.customer_name || "Customer"}{booking.customer_phone ? ` · ${booking.customer_phone}` : ""}</p>
                    <p className="text-xs text-slate-700">Booking Address: {booking.booking_address || "Not available"}</p>
                    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <p className="text-[11px] font-semibold text-emerald-900 uppercase tracking-wider">Partners</p>
                      <p className="text-sm text-emerald-950 mt-0.5">{Array.isArray(booking.partners) && booking.partners.length ? booking.partners.join(", ") : "Partner"}</p>
                    </div>
                  </div>
                  <div className="text-right space-y-1">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-semibold ${statusColor}`}>
                      {String(booking.status || "pending_approval").toUpperCase()}
                    </span>
                    <p className="text-sm font-semibold text-emerald-900">₹{Number(booking.total_amount || 0).toLocaleString("en-IN")}</p>
                    <p className="text-[10px] text-slate-400">{booking.created_at ? new Date(booking.created_at).toLocaleString() : ""}</p>
                    <p className="text-[10px] text-slate-500">Payment: {String(booking.payment_method || "upi").toUpperCase()}</p>
                  </div>
                </div>

                {Array.isArray(booking.items) && booking.items.length ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1 inline-flex items-center gap-1">
                      <Building2 className="w-3 h-3" /> Service Items
                    </p>
                    <div className="space-y-1">
                      {booking.items.map((it, idx) => (
                        <p key={`${booking.id}-item-${idx}`} className="text-xs text-slate-700">
                          {it.product_name || "Service"} x {Number(it.quantity || 0)} · ₹{Number(it.subtotal || 0).toLocaleString("en-IN")}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
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
          data-testid="admin-stay-dining-prev"
        >
          ← Previous 3
        </Button>
        <Button
          variant="outline"
          className="rounded-full"
          disabled={!hasNext || loading}
          onClick={() => load(offset + PAGE_SIZE)}
          data-testid="admin-stay-dining-next"
        >
          Next 3 →
        </Button>
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { BadgeCheck, CalendarDays, CheckCircle2, ClipboardCheck, Compass, CreditCard, ExternalLink, ImagePlus, Loader2, RefreshCw, ShieldCheck, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resolveAssetUrl } from "@/lib/utils";

const STATUS_STYLE = {
  pending_approval: "bg-amber-100 text-amber-900 border-amber-200",
  paid: "bg-emerald-100 text-emerald-900 border-emerald-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  pending_payment: "bg-slate-100 text-slate-700 border-slate-200",
};

const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const statusText = (status) => String(status || "pending_approval").replaceAll("_", " ");

export default function TourismControlCenterPage() {
  const { user } = useAuth();
  const isAdmin = user && ["super_admin", "company_admin", "admin"].includes(user.role);
  const [data, setData] = useState({ summary: {}, items: [] });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [bookingImages, setBookingImages] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaUploading, setMediaUploading] = useState(false);
  const imageInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: response } = await api.get("/admin/tourism/bookings");
      setData({ summary: response?.summary || {}, items: Array.isArray(response?.items) ? response.items : [] });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Tourism bookings could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);
  const loadBookingImages = useCallback(async () => {
    setMediaLoading(true);
    try {
      const { data: response } = await api.get("/admin/tourism/booking-images");
      setBookingImages(Array.isArray(response?.items) ? response.items : []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Tourism image library could not be loaded");
    } finally {
      setMediaLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) loadBookingImages(); }, [isAdmin, loadBookingImages]);
  const bookings = useMemo(() => {
    const term = String(query || "").trim().toLowerCase();
    return data.items.filter((item) => {
      const statusOk = statusFilter === "all" || String(item.status || "") === statusFilter;
      if (!statusOk) return false;
      if (!term) return true;
      return [item.order_no, item.customer_name, item.customer_phone, item.member_code, ...(item.items || []).map((service) => service.name)]
        .join(" ").toLowerCase().includes(term);
    });
  }, [data.items, query, statusFilter]);

  if (!isAdmin) return <Navigate to="/app" replace />;

  const approve = async (booking) => {
    if (!window.confirm(`${booking.order_no} payment approve করবেন? Travel supplier confirmation এখনও আলাদাভাবে complete করতে হবে.`)) return;
    setBusyId(booking.id);
    try {
      await api.post(`/admin/orders/${booking.id}/approve`, {});
      toast.success("Payment approved. Continue supplier confirmation in the booking record.");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Approval failed");
    } finally { setBusyId(""); }
  };

  const reject = async () => {
    if (!rejectTarget) return;
    setBusyId(rejectTarget.id);
    try {
      await api.post(`/admin/orders/${rejectTarget.id}/reject`, { reason: rejectReason.trim() || "Payment could not be verified" });
      toast.success("Booking payment rejected");
      setRejectTarget(null);
      setRejectReason("");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Rejection failed");
    } finally { setBusyId(""); }
  };

  const uploadBookingImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image too large (maximum 2MB)");
      event.target.value = "";
      return;
    }
    setMediaUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await api.post("/admin/upload/tourism-booking-image", formData, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Tourism booking image added to the media library");
      loadBookingImages();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Tourism image upload failed");
    } finally {
      setMediaUploading(false);
      event.target.value = "";
    }
  };

  const summary = data.summary || {};
  return <div className="space-y-6" data-testid="tourism-control-center-page">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-sky-800 font-semibold">Travel Operations</p>
        <h1 className="mt-1 flex items-center gap-2 font-display text-3xl font-black tracking-tight text-emerald-950 md:text-4xl"><Compass className="h-8 w-8 text-sky-700" /> Tourism Control Center</h1>
        <p className="mt-1 text-sm text-muted-foreground font-body">Bookings, payment verification, traveller contact, consent audit, and supplier-ready operational queue.</p>
      </div>
      <div className="flex gap-2">
        <Link to="/app/products?upload=1"><Button variant="outline" className="rounded-full border-sky-300 text-sky-900 hover:bg-sky-50">Tourism Inventory</Button></Link>
        <Button variant="outline" className="rounded-full" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Metric title="All Bookings" value={summary.total_bookings || 0} icon={CalendarDays} tone="sky" />
      <Metric title="Payment Review" value={summary.pending_approval || 0} icon={CreditCard} tone="amber" />
      <Metric title="Paid" value={summary.paid || 0} icon={CheckCircle2} tone="emerald" />
      <Metric title="Terms Audit" value={`${summary.terms_complete || 0}/${summary.total_bookings || 0}`} icon={ShieldCheck} tone="sky" />
      <Metric title="Booking Value" value={money(summary.gross_value)} icon={BadgeCheck} tone="emerald" />
    </div>

    <section className="border border-sky-200 bg-sky-50/60 p-4 rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-display font-bold text-emerald-950">Operational Release Gate</p><p className="mt-1 text-xs text-slate-600">Approve payment only after proof review. Then confirm availability, supplier reference, inclusions, traveller documents, and final cancellation terms directly with the customer.</p></div>
        <a href="/travel-booking-terms" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-sky-900 underline">Customer terms <ExternalLink className="h-3.5 w-3.5" /></a>
      </div>
    </section>

    <section className="rounded-xl border border-emerald-200 bg-white p-5 shadow-sm" data-testid="tourism-booking-media">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800"><ImagePlus className="h-5 w-5" /></div>
          <div><p className="font-display text-lg font-bold text-emerald-950">Tourism Booking Media</p><p className="mt-1 max-w-2xl text-xs text-slate-500">Upload destination, hotel, vehicle, and itinerary visuals for the travel operations team. These files stay separate from the METHO product catalog.</p></div>
        </div>
        <>
          <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml" className="hidden" onChange={uploadBookingImage} data-testid="tourism-booking-image-file" />
          <Button type="button" onClick={() => imageInputRef.current?.click()} disabled={mediaUploading} className="rounded-full bg-emerald-800 hover:bg-emerald-900"><Upload className="mr-2 h-4 w-4" />{mediaUploading ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Uploading...</> : "Upload booking image"}</Button>
        </>
      </div>
      {mediaLoading ? <p className="mt-5 text-sm text-slate-500">Loading media library...</p> : null}
      {!mediaLoading && bookingImages.length === 0 ? <div className="mt-5 rounded-lg border border-dashed border-emerald-200 bg-emerald-50/30 p-6 text-center text-sm text-slate-500">No tourism media uploaded yet.</div> : null}
      {bookingImages.length > 0 ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{bookingImages.map((image) => <a key={image.name} href={resolveAssetUrl(image.url)} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-lg border border-slate-200 bg-slate-50"><img src={resolveAssetUrl(image.url)} alt={image.name} className="aspect-[4/3] w-full object-cover transition duration-200 group-hover:scale-105" /><span className="block truncate px-2 py-2 text-[10px] font-medium text-slate-600">{image.name}</span></a>)}</div> : null}
    </section>

    <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-white p-3">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search order, traveller, phone, service" className="max-w-sm" data-testid="tourism-search" />
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 rounded-md border border-input bg-white px-3 text-sm" data-testid="tourism-status-filter"><option value="all">All statuses</option><option value="pending_approval">Payment review</option><option value="paid">Paid</option><option value="rejected">Rejected</option></select>
      <span className="ml-auto self-center text-xs text-slate-500">Showing {bookings.length} booking(s)</span>
    </div>

    {loading ? <p className="text-sm text-muted-foreground">Loading tourism operations...</p> : null}
    {!loading && bookings.length === 0 ? <div className="border border-dashed border-sky-200 bg-white p-10 text-center text-sm text-slate-500 rounded-lg">No tourism bookings match this view.</div> : null}
    <div className="space-y-3">
      {bookings.map((booking) => <article key={booking.id} className="rounded-lg border border-border bg-white p-5" data-testid={`tourism-booking-${booking.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-xs font-semibold text-sky-800">{booking.order_no}</p><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLE[booking.status] || "bg-slate-100 text-slate-700 border-slate-200"}`}>{statusText(booking.status)}</span></div><p className="mt-2 font-display font-bold text-emerald-950">{booking.customer_name || "Traveller"}</p><p className="text-xs text-slate-600">{booking.customer_phone || "No phone"}{booking.member_code ? ` · Member ${booking.member_code}` : ""}</p></div>
          <div className="text-right"><p className="font-display text-xl font-black text-emerald-950">{money(booking.total_amount)}</p><p className="mt-1 text-[11px] text-slate-500">{new Date(booking.created_at).toLocaleString("en-IN")}</p><p className="text-[11px] font-semibold text-slate-600">{String(booking.payment_method || "-").toUpperCase()} · {booking.payment_reference || "No reference"}</p></div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <InfoBlock title="Service & Schedule" icon={CalendarDays}>{(booking.items || []).map((item, index) => <p key={`${booking.id}-${index}`} className="text-sm text-slate-700">{item.name} · {money(item.subtotal)}<span className="block text-xs text-slate-500">Requested: {item.slot_datetime || "Not recorded"}</span></p>)}</InfoBlock>
          <InfoBlock title="Booking Note" icon={ClipboardCheck}><p className="whitespace-pre-line text-sm text-slate-700">{booking.booking_note || "No additional note"}</p></InfoBlock>
          <InfoBlock title="Compliance Audit" icon={ShieldCheck}><p className={`text-sm font-semibold ${booking.terms_accepted ? "text-emerald-800" : "text-red-700"}`}>{booking.terms_accepted ? "Travel terms accepted" : "Terms acceptance missing"}</p><p className="mt-1 text-xs text-slate-500">{booking.terms_accepted_at ? new Date(booking.terms_accepted_at).toLocaleString("en-IN") : "No acceptance timestamp"}{booking.terms_version ? ` · v${booking.terms_version}` : ""}</p></InfoBlock>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {booking.payment_screenshot_url ? <a href={booking.payment_screenshot_url} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="rounded-full">Payment Proof <ExternalLink className="ml-1 h-3.5 w-3.5" /></Button></a> : null}
          {booking.status === "pending_approval" ? <><Button size="sm" disabled={busyId === booking.id} onClick={() => approve(booking)} className="rounded-full bg-emerald-800 hover:bg-emerald-900"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve Payment</Button><Button size="sm" variant="outline" disabled={busyId === booking.id} onClick={() => setRejectTarget(booking)} className="rounded-full border-red-200 text-red-700 hover:bg-red-50"><XCircle className="mr-1 h-3.5 w-3.5" />Reject</Button></> : null}
        </div>
      </article>)}
    </div>

    <Dialog open={Boolean(rejectTarget)} onOpenChange={(open) => !open && setRejectTarget(null)}><DialogContent><DialogHeader><DialogTitle>Reject Tourism Payment</DialogTitle><DialogDescription>{rejectTarget?.order_no} will remain visible for the traveller to resubmit payment.</DialogDescription></DialogHeader><Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Clear reason for traveller and operations team" /><DialogFooter><Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button><Button onClick={reject} disabled={busyId === rejectTarget?.id} className="bg-red-700 hover:bg-red-800">Reject Payment</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Metric({ title, value, icon: Icon, tone }) {
  const styles = { sky: "border-sky-200 bg-sky-50", amber: "border-amber-200 bg-amber-50", emerald: "border-emerald-200 bg-emerald-50" };
  return <div className={`rounded-lg border p-4 ${styles[tone] || styles.sky}`}><Icon className="h-5 w-5 text-emerald-800" /><p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-slate-600">{title}</p><p className="mt-1 font-display text-2xl font-black text-emerald-950">{value}</p></div>;
}

function InfoBlock({ title, icon: Icon, children }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-600"><Icon className="h-3.5 w-3.5" />{title}</p>{children}</div>;
}

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import { Store, CheckCircle2, XCircle, Filter, Phone, MapPin, Mail, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

const STATUS_STYLES = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

const REQUEST_SECTOR_FILTERS = [
  { key: "", label: "All" },
  { key: "products", label: "Products" },
  { key: "delivery-partner", label: "Delivery" },
  { key: "doorstep", label: "Doorstep" },
  { key: "other-services", label: "Others" },
];

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const extractPrimarySector = (request) => {
  const businessType = normalizeText(request?.business_type);
  const description = String(request?.business_description || "");
  const descriptionLower = normalizeText(description);
  const metaMatch = description.match(/Primary Sector:\s*([^\n|]+)/i);
  const primaryMeta = normalizeText(metaMatch?.[1] || "");
  const source = [businessType, descriptionLower, primaryMeta].filter(Boolean).join(" ");

  if (source.includes("delivery partner") || source.includes("delivery") || source.includes("courier") || source.includes("logistics")) {
    return "delivery-partner";
  }
  if (source.includes("doorstep")) {
    return "doorstep";
  }
  if (source.includes("other services") || source.includes("other service")) {
    return "other-services";
  }
  if (source.includes("shop") || source.includes("product")) {
    return "products";
  }
  return "other-services";
};

const formatSectorLabel = (sectorKey) => {
  if (sectorKey === "delivery-partner") return "Delivery";
  if (sectorKey === "doorstep") return "Doorstep";
  if (sectorKey === "other-services") return "Others";
  if (sectorKey === "products") return "Products";
  return "Others";
};

export default function PartnerApprovalsPage() {
  const { user } = useAuth();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [sectorFilter, setSectorFilter] = useState("");
  const [approveItem, setApproveItem] = useState(null);
  const [rejectItem, setRejectItem] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultCreds, setResultCreds] = useState(null);

  const load = () => api.get(`/admin/partner-requests${filter ? `?status_filter=${filter}` : ""}`).then(r => setItems(r.data)).catch(() => {});
  useEffect(() => { if (isAdmin) load(); /* eslint-disable-next-line */ }, [isAdmin, filter]);

  const doApprove = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/partner-requests/${approveItem.id}/approve`, {});
      setResultCreds(data);
      toast.success("Partner approved and activated!");
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Approve failed"); }
    finally { setBusy(false); }
  };
  const doReject = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/partner-requests/${rejectItem.id}/reject`, { reason });
      toast.success("Request rejected");
      setRejectItem(null); setReason("");
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Reject failed"); }
    finally { setBusy(false); }
  };

  const closeApprove = () => { setApproveItem(null); setResultCreds(null); };

  const pendingCount = items.filter(i => i.status === "pending").length;
  const itemsWithSector = useMemo(
    () => items.map((item) => ({ ...item, request_sector: extractPrimarySector(item) })),
    [items]
  );
  const visibleItems = useMemo(() => {
    if (!sectorFilter) return itemsWithSector;
    return itemsWithSector.filter((item) => item.request_sector === sectorFilter);
  }, [itemsWithSector, sectorFilter]);
  const sectorCounts = useMemo(() => {
    return itemsWithSector.reduce((acc, item) => {
      const key = item.request_sector || "other-services";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, { products: 0, "delivery-partner": 0, doorstep: 0, "other-services": 0 });
  }, [itemsWithSector]);

  if (!isAdmin) return <Navigate to="/app" replace />;

  return (
    <div className="space-y-6" data-testid="partner-approvals-page">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p>
        <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Partner Applications</h1>
        <p className="text-sm text-muted-foreground font-body mt-1">Public partner registrations pending your review. Approve to auto-create login credentials.</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-slate-600" />
        {["pending", "approved", "rejected", ""].map(s => (
          <button
            key={s || "all"}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition ${filter === s ? "bg-emerald-900 text-white" : "bg-white border border-border text-slate-600 hover:bg-emerald-50"}`}
            data-testid={`pr-filter-${s || "all"}`}
          >
            {s || "All"} {s === "pending" && pendingCount > 0 && `(${pendingCount})`}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-slate-600" />
        {REQUEST_SECTOR_FILTERS.map((sector) => (
          <button
            key={sector.key || "all-sectors"}
            onClick={() => setSectorFilter(sector.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition ${sectorFilter === sector.key ? "bg-emerald-900 text-white" : "bg-white border border-border text-slate-600 hover:bg-emerald-50"}`}
            data-testid={`pr-sector-${sector.key || "all"}`}
          >
            {sector.label} {sector.key ? `(${sectorCounts[sector.key] || 0})` : `(${itemsWithSector.length})`}
          </button>
        ))}
      </div>

      {visibleItems.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-10 text-center">
          <Store className="w-10 h-10 text-slate-400 mx-auto" />
          <p className="mt-3 font-semibold text-emerald-950">No {filter || ""} applications</p>
          <p className="text-xs text-muted-foreground mt-1">Share the "Become a Partner" link on WhatsApp to invite more shops!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleItems.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-border p-5" data-testid={`pr-${p.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_STYLES[p.status] || "bg-slate-100 text-slate-700"}`}>{p.status}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{p.business_type}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">{formatSectorLabel(p.request_sector)}</span>
                  </div>
                  <p className="font-display font-black text-emerald-950 mt-2 text-lg">{p.business_name}</p>
                  <p className="text-xs text-muted-foreground font-body">
                    {p.contact_person}
                  </p>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-slate-700">
                    <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-emerald-700" /> {p.phone}</span>
                    {p.email && <span className="flex items-center gap-1.5 truncate"><Mail className="w-3.5 h-3.5 text-emerald-700" /> {p.email}</span>}
                    <span className="flex items-center gap-1.5 truncate"><MapPin className="w-3.5 h-3.5 text-emerald-700" /> {p.city}, {p.state}</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-2 font-body">{p.address} {p.pincode}</p>
                  {p.business_description && <p className="text-xs text-slate-600 mt-1 italic font-body">"{p.business_description}"</p>}
                  {p.commission_percent_ask && <p className="text-[11px] text-emerald-800 font-semibold mt-1">Preferred commission: {p.commission_percent_ask}%</p>}
                  {p.gst_no && <p className="text-[11px] text-slate-500 font-mono mt-1">GST: {p.gst_no}</p>}
                  {p.linked_partner_code && <p className="text-[11px] text-emerald-700 font-mono mt-1">Partner Code: {p.linked_partner_code}</p>}
                  {p.rejection_reason && <p className="text-[11px] text-red-700 mt-1">Reason: {p.rejection_reason}</p>}
                  <p className="text-[10px] text-slate-400 mt-2">{new Date(p.created_at).toLocaleString()}</p>
                </div>
              </div>
              {p.status === "pending" && (
                <div className="mt-3 flex justify-end gap-2">
                      <Button size="sm" onClick={() => { setApproveItem(p); }} className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-full" data-testid={`pr-approve-${p.id}`}>
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve & Activate
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejectItem(p)} className="border-red-300 text-red-700 hover:bg-red-50 rounded-full" data-testid={`pr-reject-${p.id}`}>
                    <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Approve dialog */}
      <Dialog open={!!approveItem} onOpenChange={(o) => { if (!o) closeApprove(); }}>
        <DialogContent>
          {!resultCreds ? (
            <>
              <DialogHeader>
                <DialogTitle>Approve Partner Application</DialogTitle>
                <DialogDescription>
                  <strong>{approveItem?.business_name}</strong> — {approveItem?.contact_person}
                  <br />Requested commission will be auto-applied. On approve, partner login will be activated using the Login ID and Password set during registration.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                <p className="font-semibold">Requested Commission: {approveItem?.commission_percent_ask || 10}%</p>
                <p className="text-xs mt-1 text-emerald-800">Approval will use this value automatically. Admin can still edit, deactivate, delete, or feature the partner later.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeApprove} disabled={busy}>Cancel</Button>
                <Button onClick={doApprove} disabled={busy} className="bg-emerald-700 hover:bg-emerald-800 text-white" data-testid="pr-approve-confirm">
                  {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Approving...</> : "Confirm Approve"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Partner Activated — Share Credentials</DialogTitle>
                <DialogDescription>Share these with {approveItem?.contact_person} via WhatsApp or phone. Password won't be shown again.</DialogDescription>
              </DialogHeader>
              <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-4 space-y-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">Partner Code</p>
                  <p className="font-mono font-black text-lg text-emerald-950">{resultCreds.partner_code}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">Login ID</p>
                  <p className="font-mono text-sm text-emerald-950">{resultCreds.login_email || resultCreds.email}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">Password</p>
                  <p className="font-mono font-black text-lg text-emerald-950 tracking-wider select-all" data-testid="pr-result-password">{resultCreds.login_password || resultCreds.password}</p>
                </div>
                <Button size="sm" onClick={() => { navigator.clipboard.writeText(`Login: ${resultCreds.login_email || resultCreds.email}\nPassword: ${resultCreds.login_password || resultCreds.password}\nCode: ${resultCreds.partner_code}`); toast.success("Copied"); }} className="mt-2 bg-emerald-900 hover:bg-emerald-950 text-white rounded-full">
                  <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy All
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={closeApprove} className="bg-emerald-900 hover:bg-emerald-950 text-white">Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectItem} onOpenChange={(o) => { if (!o) { setRejectItem(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Partner Application</DialogTitle>
            <DialogDescription>{rejectItem?.business_name}</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Rejection Reason</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional but recommended)" className="mt-1.5" data-testid="pr-reject-reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectItem(null); setReason(""); }}>Cancel</Button>
            <Button onClick={doReject} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white" data-testid="pr-reject-confirm">Confirm Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


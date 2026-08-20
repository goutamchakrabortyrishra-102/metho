import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { CarTaxiFront, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";

const ADMIN_ROLES = ["super_admin", "company_admin", "admin"];
const EMPTY = { name: "", phone: "", whatsapp: "", vehicle_number: "", vehicle_type: "", service_sector: "transport" };

export default function DriverRegistryPage() {
  const { user } = useAuth();
  const isPartner = user?.role === "partner";
  const isAdmin = ADMIN_ROLES.includes(user?.role);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(isPartner ? "/partner/drivers" : "/admin/drivers");
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Unable to load driver registry");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isPartner || isAdmin) load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPartner, isAdmin]);

  const addDriver = async (event) => {
    event.preventDefault();
    try {
      await api.post("/partner/drivers", form);
      toast.success("Driver submitted for admin approval");
      setForm(EMPTY);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Driver save failed");
    }
  };

  const review = async (driver, approval_status) => {
    try {
      await api.post(`/admin/drivers/${driver.id}/review`, { approval_status, active: approval_status === "approved" });
      toast.success(`Driver ${approval_status}`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Driver review failed");
    }
  };

  const toggleActive = async (driver) => {
    try {
      await api.patch(`/partner/drivers/${driver.id}`, { active: !driver.active });
      toast.success(driver.active ? "Driver deactivated" : "Driver activated");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Driver status update failed");
    }
  };

  if (!isPartner && !isAdmin) return <Navigate to="/app" replace />;

  return (
    <div className="space-y-6" data-testid="driver-registry-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">{isAdmin ? "Admin" : "Partner"}</p>
          <h1 className="font-display font-black text-3xl text-emerald-950 mt-1 flex items-center gap-2"><CarTaxiFront className="w-8 h-8" /> Drivers, Vehicles &amp; Delivery Agents</h1>
          <p className="text-sm text-slate-600 mt-1">Manage transport drivers and delivery agents together. Approved active records can be assigned to the correct booking sector.</p>
        </div>
        <Button variant="outline" className="rounded-full" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
      </div>

      {isPartner ? (
        <form onSubmit={addDriver} className="rounded-xl border border-sky-200 bg-sky-50 p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Name</Label><Input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="mt-1" placeholder="Driver / delivery agent" /></div>
          <div><Label>Phone</Label><Input required value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="mt-1" placeholder="Mobile number" /></div>
          <div><Label>WhatsApp</Label><Input value={form.whatsapp} onChange={(e) => setForm((p) => ({ ...p, whatsapp: e.target.value }))} className="mt-1" placeholder="Optional" /></div>
          <div><Label>Vehicle number</Label><Input value={form.vehicle_number} onChange={(e) => setForm((p) => ({ ...p, vehicle_number: e.target.value }))} className="mt-1" placeholder="WB01A1234" /></div>
          <div><Label>Vehicle / role</Label><Input value={form.vehicle_type} onChange={(e) => setForm((p) => ({ ...p, vehicle_type: e.target.value }))} className="mt-1" placeholder="Cab, bike, van" /></div>
          <div><Label>Sector</Label><select value={form.service_sector} onChange={(e) => setForm((p) => ({ ...p, service_sector: e.target.value }))} className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm"><option value="transport">Transport</option><option value="delivery">Delivery</option></select></div>
          <Button type="submit" className="rounded-full bg-emerald-900 hover:bg-emerald-950 md:col-span-3">Add for Admin Approval</Button>
        </form>
      ) : null}

      <div className="grid gap-3">
        {items.length === 0 ? <div className="rounded-xl border bg-white p-8 text-center text-slate-500">No drivers found.</div> : items.map((driver) => (
          <div key={driver.id} className="rounded-xl border bg-white p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><p className="font-semibold text-emerald-950">{driver.name}</p><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${driver.approval_status === "approved" ? "bg-emerald-100 text-emerald-800" : driver.approval_status === "rejected" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>{driver.approval_status || "pending"}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${driver.active ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-600"}`}>{driver.active ? "active" : "inactive"}</span></div>
              <p className="text-xs text-slate-600 mt-1">{driver.phone} · {driver.vehicle_type || "Vehicle"} {driver.vehicle_number ? `· ${driver.vehicle_number}` : ""} · {driver.service_sector}</p>
              {isAdmin ? <p className="text-[11px] text-slate-500 mt-1">Partner: {driver.business_name || driver.partner_code}</p> : null}
              {driver.live_location ? <p className="text-[11px] text-sky-700 mt-1">GPS updated {new Date(driver.live_location.updated_at).toLocaleString()}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {isAdmin && driver.approval_status === "pending" ? <><Button size="sm" className="rounded-full bg-emerald-700" onClick={() => review(driver, "approved")}><CheckCircle2 className="w-4 h-4 mr-1" /> Approve</Button><Button size="sm" variant="outline" className="rounded-full text-rose-700" onClick={() => review(driver, "rejected")}><XCircle className="w-4 h-4 mr-1" /> Reject</Button></> : null}
              {isPartner && driver.approval_status === "approved" ? <Button size="sm" variant="outline" className="rounded-full" onClick={() => toggleActive(driver)}>{driver.active ? "Set Inactive" : "Set Active"}</Button> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

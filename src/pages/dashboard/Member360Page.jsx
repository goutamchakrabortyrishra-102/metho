import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, Pencil, Save, X } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";

export default function Member360Page() {
  const { memberId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = Boolean(user && (user.role === "super_admin" || user.role === "company_admin" || user.role === "admin"));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  const load = () => {
    if (!memberId) return;
    setLoading(true);
    api.get(`/admin/members/${memberId}/360`)
      .then(({ data: payload }) => {
        setData(payload);
        setError("");
      })
      .catch((err) => {
        setError(err?.response?.data?.detail || "Member profile could not be loaded");
        setData(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [memberId]);

  const editMode = () => {
    if (!data?.profile) return;
    setForm({
      id: data.profile.user_id,
      member_code: data.profile.member_code,
      name: data.profile.name || "",
      email: data.profile.email || "",
      phone: data.profile.phone || "",
      sponsor_code: data.network?.sponsor_code || "",
      dob: data.profile.dob || "",
      pan_no: data.profile.pan_no || "",
      aadhaar_no: data.profile.aadhaar_no || "",
      address: data.profile.address || "",
      city: data.profile.city || "",
      state: data.profile.state || "",
      pincode: data.profile.pincode || "",
      role: "member",
      is_active: data.profile.status !== false,
    });
    setEditing(true);
  };

  const save = async () => {
    if (!data?.profile?.user_id || !isAdmin) return;
    setSaving(true);
    try {
      const payload = {
        name: String(form.name || "").trim(),
        email: String(form.email || "").trim().toLowerCase(),
        username: String(form.member_code || form.email || "").trim(),
        member_code: String(form.member_code || form.email || "").trim(),
        phone: String(form.phone || "").trim(),
        sponsor_code: String(form.sponsor_code || "").trim().toUpperCase(),
        dob: form.dob || null,
        pan_no: String(form.pan_no || "").trim().toUpperCase(),
        aadhaar_no: String(form.aadhaar_no || "").replace(/\D/g, "").slice(0, 12),
        address: String(form.address || "").trim(),
        city: String(form.city || "").trim(),
        state: String(form.state || "").trim(),
        pincode: String(form.pincode || "").trim(),
        role: "member",
        active: !!form.is_active,
      };
      await api.put(`/admin/users/${data.profile.user_id}`, payload);
      setEditing(false);
      load();
    } catch (err) {
      setError(err?.response?.data?.detail || "Profile update failed");
    } finally {
      setSaving(false);
    }
  };

  const hasLoaded = Boolean(data?.profile);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Member 360</p>
          <h1 className="text-2xl font-bold text-slate-900">{data?.profile?.name || "Member Profile"}</h1>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button type="button" variant="outline" className="rounded-full" onClick={editMode}>
              <Pencil className="w-4 h-4 mr-2" /> Edit Profile
            </Button>
          )}
          <Button type="button" variant="outline" className="rounded-full" onClick={() => nav("/admin/members")}>Back to Members</Button>
        </div>
      </div>

      {loading && <div className="bg-white rounded-xl border border-border p-6 text-slate-500">Loading member profile...</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>}

      {hasLoaded && !editing && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">Member code</p><p className="text-xl font-bold">{data.profile?.member_code}</p></div>
            <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">Phone</p><p className="text-xl font-bold">{data.profile?.phone}</p></div>
            <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">Join date</p><p className="text-xl font-bold">{data.profile?.join_date}</p></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-border p-4">
              <h2 className="font-semibold mb-3">Profile Details</h2>
              <div className="grid grid-cols-1 gap-2 text-sm">
                <div><span className="font-semibold text-slate-600">Name:</span> {data.profile?.name}</div>
                <div><span className="font-semibold text-slate-600">Email:</span> {data.profile?.email}</div>
                <div><span className="font-semibold text-slate-600">Status:</span> <span className={data.profile?.status ? "text-emerald-700" : "text-red-700"}>{data.profile?.status ? "Active" : "Inactive"}</span></div>
                <div><span className="font-semibold text-slate-600">Sponsor:</span> {data.network?.sponsor || "-"}</div>
                <div><span className="font-semibold text-slate-600">Sponsor Code:</span> {data.network?.sponsor_code || "-"}</div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-border p-4">
              <h2 className="font-semibold mb-3">Business & Orders</h2>
              <ul className="space-y-2 text-sm text-slate-700">
                <li>Total orders: {data.business?.total_orders}</li>
                <li>Completed orders: {data.business?.completed_orders}</li>
                <li>Total purchase: {data.business?.total_purchase}</li>
                <li>Last order: {data.business?.last_order || "-"}</li>
              </ul>
            </div>

            <div className="bg-white rounded-xl border border-border p-4">
              <h2 className="font-semibold mb-3">CRM</h2>
              <ul className="space-y-2 text-sm text-slate-700">
                <li>Lead status: {data.crm?.lead_status || "-"}</li>
                <li>Next follow-up: {data.crm?.next_follow_up || "-"}</li>
                <li>Last contact: {data.crm?.last_contact || "-"}</li>
                <li>Notes: {data.crm?.notes || "-"}</li>
              </ul>
            </div>

            <div className="bg-white rounded-xl border border-border p-4">
              <h2 className="font-semibold mb-3">Finance</h2>
              <ul className="space-y-2 text-sm text-slate-700">
                <li>Wallet: {data.finance?.wallet || "-"}</li>
                <li>Rewards: {data.finance?.rewards || "-"}</li>
                <li>Withdrawals: {data.finance?.withdrawals || "-"}</li>
                <li>Settlement: {data.finance?.settlement || "-"}</li>
              </ul>
            </div>
          </div>

          {data.business?.recent_orders?.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-4">
              <h2 className="font-semibold mb-3">Recent Orders</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr><th className="py-2">Order ID</th><th>Status</th><th>Total</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {data.business.recent_orders.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="py-2 font-mono">{row.id}</td>
                        <td>{row.status}</td>
                        <td>{row.total_amount}</td>
                        <td>{row.created_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.crm?.activity_timeline?.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-4">
              <h2 className="font-semibold mb-3">CRM Activity Timeline</h2>
              <ul className="space-y-2 text-sm">
                {data.crm.activity_timeline.map((row) => (
                  <li key={row.id} className="border-b pb-2 last:border-b-0">
                    <span className="font-semibold">{row.activity_type}</span> - {row.message} <span className="text-slate-500">({row.created_at})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {hasLoaded && editing && (
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Edit Member</p>
              <h2 className="font-display font-black text-2xl text-slate-900">Member Profile</h2>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(false)} className="rounded-full"><X className="w-4 h-4 mr-2" />Cancel</Button>
              <Button type="button" onClick={save} className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <div><Label>Name</Label><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>Phone</Label><Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1.5" /></div>
            <div><Label>Email</Label><Input value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1.5" /></div>
            <div><Label>Member Code</Label><Input value={form.member_code || ""} readOnly className="mt-1.5 bg-slate-50" /></div>
            <div><Label>Sponsor Code</Label><Input value={form.sponsor_code || ""} onChange={(e) => setForm({ ...form, sponsor_code: e.target.value.toUpperCase() })} className="mt-1.5 uppercase" /></div>
            <div><Label>DOB</Label><Input type="date" value={form.dob || ""} onChange={(e) => setForm({ ...form, dob: e.target.value })} className="mt-1.5" /></div>
            <div><Label>PAN</Label><Input value={form.pan_no || ""} onChange={(e) => setForm({ ...form, pan_no: e.target.value.toUpperCase() })} className="mt-1.5 uppercase" /></div>
            <div><Label>Aadhaar</Label><Input value={form.aadhaar_no || ""} onChange={(e) => setForm({ ...form, aadhaar_no: e.target.value.replace(/\D/g, "").slice(0, 12) })} className="mt-1.5" /></div>
            <div className="md:col-span-2"><Label>Address</Label><Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1.5" /></div>
            <div><Label>City</Label><Input value={form.city || ""} onChange={(e) => setForm({ ...form, city: e.target.value })} className="mt-1.5" /></div>
            <div><Label>State</Label><Input value={form.state || ""} onChange={(e) => setForm({ ...form, state: e.target.value })} className="mt-1.5" /></div>
            <div><Label>Pincode</Label><Input value={form.pincode || ""} onChange={(e) => setForm({ ...form, pincode: e.target.value })} className="mt-1.5" /></div>
            <label className="flex items-center gap-2 text-sm cursor-pointer mt-7">
              <input type="checkbox" checked={!!form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4" />
              Active
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

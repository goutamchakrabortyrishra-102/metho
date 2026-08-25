import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Plus, RefreshCw, ArrowUpRight, CircleAlert, Phone, MessageSquareText, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import api from "@/services/api";

const stageOptions = ["NEW", "CONTACTED", "INTERESTED", "QUALIFIED", "APPLICATION", "APPROVED", "CONVERTED", "LOST"];

export default function CRMLeadsPage() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [conversionLead, setConversionLead] = useState(null);
  const [conversionBusy, setConversionBusy] = useState(false);
  const [conversionForm, setConversionForm] = useState({ login_id: "", password: "", pan_no: "", aadhaar_no: "", business_type: "Shop" });
  const [conversionStatus, setConversionStatus] = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [assignedUserId, setAssignedUserId] = useState("ALL");
  const [source, setSource] = useState("ALL");
  const [taskForm, setTaskForm] = useState({ lead_id: "", title: "", description: "", due_at: "", priority: "Medium", assigned_user_id: "" });
  const [form, setForm] = useState({
    business_name: "",
    business_type: "Retail Shop",
    contact_person: "",
    phone: "",
    whatsapp_no: "",
    email: "",
    city: "",
    state: "",
    pincode: "",
    address: "",
    notes: "",
    score: 0,
    priority_bucket: "Cold",
    status: "NEW",
  });

  const summary = useMemo(() => ({
    total: items.length,
    hot: items.filter((item) => item.priority_bucket === "Hot").length,
    warm: items.filter((item) => item.priority_bucket === "Warm").length,
    cold: items.filter((item) => item.priority_bucket === "Cold").length,
  }), [items]);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/crm/leads", {
        params: { search: search || undefined, status: status === "ALL" ? undefined : status, assigned_user_id: assignedUserId === "ALL" ? undefined : assignedUserId, source: source === "ALL" ? undefined : source },
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not load CRM leads");
    } finally {
      setLoading(false);
    }
  }, [search, status, assignedUserId, source]);

  useEffect(() => { loadLeads(); }, [loadLeads]);
  useEffect(() => {
    api.get("/admin/crm/assignees").then(({ data }) => setAssignees(Array.isArray(data?.items) ? data.items : [])).catch(() => setAssignees([]));
  }, []);

  const createLead = async () => {
    try {
      const payload = { ...form, score: Number(form.score || 0) };
      const { data } = await api.post("/admin/crm/leads", payload);
      if (data?.ok === false) {
        throw new Error(data?.detail || "Lead could not be saved");
      }
      setForm({
        business_name: "",
        business_type: "Retail Shop",
        contact_person: "",
        phone: "",
        whatsapp_no: "",
        email: "",
        city: "",
        state: "",
        pincode: "",
        address: "",
        notes: "",
        score: 0,
        priority_bucket: "Cold",
        status: "NEW",
      });
      await loadLeads();
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || "Could not create lead");
    }
  };

  const openConversion = async (lead) => {
    setConversionLead(lead);
    setConversionForm({ login_id: lead.email || "", password: "", pan_no: "", aadhaar_no: "", business_type: lead.business_type?.toLowerCase().includes("service") ? "Service" : "Shop" });
    try {
      const { data } = await api.get(`/admin/crm/leads/${lead.id}/conversion`);
      setConversionStatus(data?.conversion || null);
    } catch (err) {
      setConversionStatus({ status: "error", label: err?.response?.data?.detail || "Could not load conversion status" });
    }
  };

  const convertToPartner = async () => {
    if (!conversionLead) return;
    if (!window.confirm(`Submit ${conversionLead.business_name} to the official PartnerRequest approval queue?`)) return;
    setConversionBusy(true);
    setError("");
    try {
      const { data } = await api.post(`/admin/crm/leads/${conversionLead.id}/convert-to-partner`, conversionForm);
      setConversionStatus({ status: data.status, label: data.message, request_id: data.request_id });
      await loadLeads();
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not start partner conversion");
    } finally { setConversionBusy(false); }
  };

  const assignLead = async (leadId, value) => {
    try {
      await api.post(`/admin/crm/leads/${leadId}/assignment`, { assigned_user_id: value || null });
      await loadLeads();
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not assign lead");
    }
  };

  const createTask = async () => {
    if (!taskForm.lead_id || !taskForm.title || !taskForm.due_at || !taskForm.assigned_user_id) {
      setError("Task lead, title, due date, and assignee are required");
      return;
    }
    try {
      await api.post("/admin/crm/tasks", taskForm);
      setTaskForm({ lead_id: "", title: "", description: "", due_at: "", priority: "Medium", assigned_user_id: "" });
      setError("");
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not create task");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">METHO Business CRM</p>
          <h1 className="text-2xl font-bold text-slate-900">CRM Leads</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadLeads} className="rounded-full"><RefreshCw className="w-4 h-4 mr-2" /> Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase">Total leads</p><p className="text-2xl font-bold">{summary.total}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase">Hot</p><p className="text-2xl font-bold text-red-600">{summary.hot}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase">Warm/Cold</p><p className="text-2xl font-bold text-amber-600">{summary.warm + summary.cold}</p></div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="text-sm text-slate-600">Search</label>
            <div className="relative mt-1.5">
              <Search className="w-4 h-4 absolute left-3 top-3.5 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Business, contact, city or phone" className="pl-9" />
            </div>
          </div>
          <div>
            <label className="text-sm text-slate-600">Stage</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1.5 w-full rounded-md border border-input px-3 py-2 text-sm">
              <option value="ALL">All stages</option>
              {stageOptions.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">Assigned to</label>
            <select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)} className="mt-1.5 w-full rounded-md border border-input px-3 py-2 text-sm">
              <option value="ALL">All assignees</option>
              {assignees.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">Source</label>
            <select value={source} onChange={(e) => setSource(e.target.value)} className="mt-1.5 w-full rounded-md border border-input px-3 py-2 text-sm">
              <option value="ALL">All sources</option>
              <option value="facebook">Facebook Lead Ads</option>
              <option value="manual">Manual</option>
              <option value="partners_page">Partners page</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 border-t border-border pt-4">
          <select value={taskForm.lead_id} onChange={(e) => setTaskForm({ ...taskForm, lead_id: e.target.value })} className="rounded-md border border-input px-3 py-2 text-sm">
            <option value="">Task lead</option>
            {items.map((lead) => <option key={lead.id} value={lead.id}>{lead.business_name}</option>)}
          </select>
          <Input value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} placeholder="Task title" />
          <Input type="datetime-local" value={taskForm.due_at} onChange={(e) => setTaskForm({ ...taskForm, due_at: e.target.value })} />
          <select value={taskForm.assigned_user_id} onChange={(e) => setTaskForm({ ...taskForm, assigned_user_id: e.target.value })} className="rounded-md border border-input px-3 py-2 text-sm">
            <option value="">Task assignee</option>
            {assignees.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
          <div className="flex gap-2">
            <select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })} className="min-w-0 flex-1 rounded-md border border-input px-3 py-2 text-sm">
              {['Low', 'Medium', 'High', 'Urgent'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
            <Button onClick={createTask} variant="outline">Add task</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} placeholder="Business name" />
          <Input value={form.business_type} onChange={(e) => setForm({ ...form, business_type: e.target.value })} placeholder="Business type" />
          <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} placeholder="Contact person" />
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" />
          <Input value={form.whatsapp_no} onChange={(e) => setForm({ ...form, whatsapp_no: e.target.value })} placeholder="WhatsApp" />
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" />
          <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" />
          <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="State" />
          <Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} placeholder="Pincode" />
          <Input type="number" value={form.score} onChange={(e) => setForm({ ...form, score: Number(e.target.value || 0) })} placeholder="Lead score" />
          <select value={form.priority_bucket} onChange={(e) => setForm({ ...form, priority_bucket: e.target.value })} className="rounded-md border border-input px-3 py-2 text-sm">
            <option value="Cold">Cold</option>
            <option value="Warm">Warm</option>
            <option value="Hot">Hot</option>
          </select>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="rounded-md border border-input px-3 py-2 text-sm">
            {stageOptions.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
          </select>
          <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="md:col-span-2 rounded-md border border-input px-3 py-2 text-sm min-h-[80px]" placeholder="Address" />
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="md:col-span-2 rounded-md border border-input px-3 py-2 text-sm min-h-[80px]" placeholder="Notes" />
        </div>

        <div className="flex justify-end">
          <Button onClick={createLead} className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"><Plus className="w-4 h-4 mr-2" /> Save lead</Button>
        </div>
      </div>

      {error ? <div className="text-sm text-red-600 flex items-center gap-2"><CircleAlert className="w-4 h-4" /> {error}</div> : null}

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="px-3 py-2 text-left">Business</th>
                <th className="px-3 py-2 text-left">Contact</th>
                <th className="px-3 py-2 text-left">City</th>
                <th className="px-3 py-2 text-left">Score</th>
                <th className="px-3 py-2 text-left">Stage</th>
                <th className="px-3 py-2 text-left">Assignee</th>
                <th className="px-3 py-2 text-left">Next follow-up</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="p-4 text-center text-slate-500">Loading leads...</td></tr> : null}
              {!loading && items.length === 0 ? <tr><td colSpan={7} className="p-4 text-center text-slate-500">No leads found</td></tr> : null}
              {items.map((lead) => (
                <tr key={lead.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-900">{lead.business_name}</div>
                    <div className="text-xs text-slate-500">{lead.business_type || "-"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-slate-500" /> {lead.phone || "-"}</div>
                    <div className="flex items-center gap-2 mt-1"><MessageSquareText className="w-3.5 h-3.5 text-slate-500" /> {lead.whatsapp_no || "-"}</div>
                  </td>
                  <td className="px-3 py-2">{lead.city || "-"}</td>
                  <td className="px-3 py-2"><span className="px-2 py-1 rounded-full bg-slate-100">{lead.score || 0}</span></td>
                  <td className="px-3 py-2"><span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-800">{lead.status || "NEW"}</span></td>
                  <td className="px-3 py-2">
                    <select value={lead.assigned_user_id || ""} onChange={(e) => assignLead(lead.id, e.target.value)} className="rounded-md border border-input px-2 py-1 text-xs">
                      <option value="">Unassigned</option>
                      {assignees.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">{lead.next_follow_up_at || "-"} <ArrowUpRight className="w-4 h-4 text-slate-400" /></div>
                    {(["QUALIFIED", "APPLICATION", "APPROVED"].includes(lead.status) && !lead.partner_request_id && !lead.partner_id && !lead.converted_partner_id) ? (
                      <Button size="sm" variant="outline" className="mt-2" onClick={() => openConversion(lead)}><ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> Convert to Partner</Button>
                    ) : null}
                    {lead.partner_request_id && !lead.converted_partner_id ? <span className="mt-2 block text-xs text-amber-700">PartnerRequest pending</span> : null}
                    {lead.converted_partner_id || lead.partner_id ? <span className="mt-2 block text-xs text-emerald-700">Already Partner</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={Boolean(conversionLead)} onOpenChange={(open) => { if (!open) setConversionLead(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to Partner</DialogTitle>
            <DialogDescription>{conversionLead?.business_name} will enter the existing PartnerRequest approval queue. CRM status changes only after approval.</DialogDescription>
          </DialogHeader>
          {conversionStatus?.status && conversionStatus.status !== "not_started" ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{conversionStatus.label}{conversionStatus.request_id ? ` · ${conversionStatus.request_id}` : ""}</div>
          ) : (
            <div className="space-y-3">
              <Input value={conversionForm.login_id} onChange={(e) => setConversionForm({ ...conversionForm, login_id: e.target.value })} placeholder="Login ID / email" />
              <Input type="password" value={conversionForm.password} onChange={(e) => setConversionForm({ ...conversionForm, password: e.target.value })} placeholder="Partner login password" />
              <Input value={conversionForm.pan_no} onChange={(e) => setConversionForm({ ...conversionForm, pan_no: e.target.value })} placeholder="PAN number" />
              <Input value={conversionForm.aadhaar_no} onChange={(e) => setConversionForm({ ...conversionForm, aadhaar_no: e.target.value })} placeholder="12-digit Aadhaar number" />
              <select value={conversionForm.business_type} onChange={(e) => setConversionForm({ ...conversionForm, business_type: e.target.value })} className="w-full rounded-md border border-input px-3 py-2 text-sm"><option value="Shop">Shop</option><option value="Service">Service</option></select>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConversionLead(null)}>Close</Button>
            {(!conversionStatus || conversionStatus.status === "not_started") ? <Button onClick={convertToPartner} disabled={conversionBusy}>Submit for approval</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

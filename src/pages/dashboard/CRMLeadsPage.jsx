import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Plus, RefreshCw, ArrowUpRight, CircleAlert, Eye, Phone, PhoneCall, MessageSquareText, ArrowRightLeft, Trash2, Printer, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import api from "@/services/api";
import { useSearchParams } from "react-router-dom";

const stageOptions = ["NEW", "CONTACTED", "INTERESTED", "QUALIFIED", "APPLICATION", "APPROVED", "CONVERTED", "LOST"];
const classificationOptions = [
  { key: "ALL", label: "All leads", stages: stageOptions },
  { key: "NEW", label: "New", stages: ["NEW"] },
  { key: "OLD", label: "Old / Contacted", stages: ["CONTACTED"] },
  { key: "INTERESTED", label: "Interested", stages: ["INTERESTED", "QUALIFIED"] },
  { key: "REGISTRATION", label: "Registration started", stages: ["APPLICATION"] },
  { key: "COMPLETED", label: "Completed", stages: ["APPROVED", "CONVERTED"] },
  { key: "REJECTED", label: "Reject / Lost", stages: ["LOST"] },
];

export default function CRMLeadsPage() {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(() => searchParams.get("status") || "ALL");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [conversionLead, setConversionLead] = useState(null);
  const [conversionBusy, setConversionBusy] = useState(false);
  const [conversionForm, setConversionForm] = useState({ login_id: "", password: "", pan_no: "", aadhaar_no: "", business_type: "Shop" });
  const [conversionStatus, setConversionStatus] = useState(null);
  const [voiceCallBusyId, setVoiceCallBusyId] = useState("");
  const [voiceCallMessage, setVoiceCallMessage] = useState("");
  const [detailLead, setDetailLead] = useState(null);
  const [detailActivities, setDetailActivities] = useState([]);
  const [detailFollowups, setDetailFollowups] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
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

  const funnel = useMemo(() => {
    const sourceLeads = items.filter((lead) => ["facebook", "whatsapp"].includes(String(lead.source || "").toLowerCase()));
    const registered = items.filter((lead) => Boolean(lead.member_user_id || ["APPLICATION", "APPROVED", "CONVERTED"].includes(lead.status)));
    const purchased = items.filter((lead) => Boolean(lead.member_user_id && ["APPROVED", "CONVERTED"].includes(lead.status)));
    const repeat = items.filter((lead) => Boolean(lead.member_user_id && lead.status === "CONVERTED"));
    return [
      { key: "lead", label: "Meta / WhatsApp Leads", value: sourceLeads.length, help: "Leads from online campaigns and WhatsApp" },
      { key: "registered", label: "Registration Started", value: registered.length, help: "Lead linked to a registration or application" },
      { key: "purchase", label: "First Purchase / Approval", value: purchased.length, help: "Verified member or approved conversion" },
      { key: "repeat", label: "Repeat / Converted", value: repeat.length, help: "Converted or repeat-business stage" },
    ];
  }, [items]);

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

  const startVoiceCall = async (lead) => {
    if (voiceCallBusyId) return;
    if (!lead.phone && !lead.whatsapp_no) {
      setError("This lead has no phone number for a voice call");
      return;
    }
    if (!window.confirm(`Start a voice call for ${lead.contact_person || lead.business_name}?`)) return;
    setVoiceCallBusyId(lead.id);
    setVoiceCallMessage("");
    setError("");
    try {
      const { data } = await api.post(`/admin/crm/leads/${lead.id}/voice-calls`, { preferred_language: "bn" });
      setVoiceCallMessage(`${lead.business_name || "Lead"}: ${data?.call?.status || "CALL_PENDING"}`);
      await loadLeads();
    } catch (err) {
      setError(err?.response?.data?.detail || "Voice call could not be started. Check AI Voice Caller settings.");
    } finally {
      setVoiceCallBusyId("");
    }
  };

  const openLeadDetails = async (lead) => {
    setDetailLead(lead);
    setDetailLoading(true);
    try {
      const { data } = await api.get(`/admin/crm/leads/${lead.id}/activities`);
      setDetailActivities(Array.isArray(data?.items) ? data.items : []);
      setDetailFollowups(Array.isArray(data?.followups) ? data.followups : []);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not load lead timeline");
      setDetailActivities([]);
      setDetailFollowups([]);
    } finally { setDetailLoading(false); }
  };

  const updateLeadStage = async (stage) => {
    if (!detailLead) return;
    try {
      const { data } = await api.put(`/admin/crm/leads/${detailLead.id}`, { status: stage });
      setDetailLead(data?.lead || { ...detailLead, status: stage });
      await loadLeads();
      await openLeadDetails(data?.lead || { ...detailLead, status: stage });
    } catch (err) { setError(err?.response?.data?.detail || "Could not update lead stage"); }
  };

  const deleteLostLead = async (lead) => {
    if (lead.status !== "LOST") return;
    if (!window.confirm(`Delete rejected lead ${lead.business_name}? CRM history and chat activity for this lead will be removed.`)) return;
    try {
      await api.delete(`/admin/crm/leads/${lead.id}`);
      setDetailLead(null);
      await loadLeads();
    } catch (err) { setError(err?.response?.data?.detail || "Rejected lead could not be deleted"); }
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

  const printLeads = () => {
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const rows = items.map((lead) => `
      <tr>
        <td>${escapeHtml(lead.business_name)}<br/><span class="muted">${escapeHtml(lead.business_type || "-")}</span></td>
        <td>${escapeHtml(lead.contact_person || "-")}<br/>${escapeHtml(lead.phone || lead.whatsapp_no || "-")}</td>
        <td>${escapeHtml(lead.city || "-")}</td>
        <td>${escapeHtml(lead.score || 0)}</td>
        <td>${escapeHtml(lead.status || "NEW")}</td>
        <td>${escapeHtml(lead.priority_bucket || "-")}</td>
        <td>${escapeHtml(lead.next_follow_up_at ? new Date(lead.next_follow_up_at).toLocaleString() : "-")}<br/><span class="muted">${escapeHtml(lead.follow_up_status || "Pending")}</span></td>
      </tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>METHO CRM Leads</title><style>
      body{font-family:Arial,Helvetica,sans-serif;padding:16px;color:#111;}
      h1{font-size:18px;margin:0 0 4px;}
      p.meta{font-size:12px;color:#555;margin:0 0 14px;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top;}
      th{background:#f1f5f9;}
      .muted{color:#666;font-size:11px;}
      @media print { button{ display:none; } }
    </style></head><body>
      <h1>METHO CRM Leads</h1>
      <p class="meta">Stage: ${escapeHtml(status)} · Assignee: ${escapeHtml(assignedUserId)} · Source: ${escapeHtml(source)} · Total: ${items.length} · Printed: ${new Date().toLocaleString()}</p>
      <table><thead><tr><th>Business</th><th>Contact</th><th>City</th><th>Score</th><th>Stage</th><th>Priority</th><th>Next follow-up</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No leads found</td></tr>'}</tbody></table>
    </body></html>`;
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1000,height=800");
    if (!printWindow) { setError("Popup blocked. Allow popups to print CRM leads."); return; }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const downloadFunnelPdf = () => {
    const rows = funnel.map((step) => `<tr><td>${step.label}</td><td>${step.value}</td><td>${step.help}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>METHO Funnel Report</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{color:#064e3b}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:10px;text-align:left}th{background:#e2e8f0}.meta{color:#555}</style></head><body><h1>METHO Business Funnel</h1><p class="meta">Generated ${new Date().toLocaleString()}</p><table><thead><tr><th>Stage</th><th>Count</th><th>Meaning</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`;
    const report = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!report) { setError("Popup blocked. Allow popups to download the funnel as PDF."); return; }
    report.document.write(html); report.document.close(); report.focus();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">METHO Business CRM</p>
          <h1 className="text-2xl font-bold text-slate-900">CRM Leads</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={printLeads} className="rounded-full"><Printer className="w-4 h-4 mr-2" /> Print</Button>
          <Button variant="outline" onClick={loadLeads} className="rounded-full"><RefreshCw className="w-4 h-4 mr-2" /> Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase">Total leads</p><p className="text-2xl font-bold">{summary.total}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase">Hot</p><p className="text-2xl font-bold text-red-600">{summary.hot}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase">Warm/Cold</p><p className="text-2xl font-bold text-amber-600">{summary.warm + summary.cold}</p></div>
      </div>

      <section aria-labelledby="funnel-title" className="rounded-xl border border-emerald-200 bg-emerald-950 p-4 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs uppercase tracking-[0.2em] text-emerald-200">Business Journey</p><h2 id="funnel-title" className="mt-1 text-xl font-bold">Lead to Repeat Business</h2><p className="mt-1 text-sm text-emerald-100">One clear view of where customers are moving next.</p></div>
          <Button type="button" variant="outline" onClick={downloadFunnelPdf} className="border-emerald-300 bg-white text-emerald-950 hover:bg-emerald-50"><Download className="mr-2 h-4 w-4" /> Download / Print PDF</Button>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-4" role="list" aria-label="Business funnel stages">
          {funnel.map((step, index) => <div key={step.key} role="listitem" className="relative rounded-lg bg-white p-4 text-emerald-950"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Step {index + 1}</p><p className="mt-2 text-sm font-semibold">{step.label}</p><p className="mt-1 text-3xl font-black" aria-label={`${step.value} ${step.label}`}>{step.value}</p><p className="mt-1 text-xs text-slate-600">{step.help}</p>{index < funnel.length - 1 ? <span className="hidden md:block absolute -right-2 top-1/2 z-10 text-emerald-300" aria-hidden="true">→</span> : null}</div>)}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {classificationOptions.map((option) => {
          const count = option.stages.reduce((total, stage) => total + items.filter((lead) => lead.status === stage).length, 0);
          const active = option.key === "ALL" ? status === "ALL" : option.stages.includes(status);
          return <Button key={option.key} variant={active ? "default" : "outline"} size="sm" onClick={() => setStatus(option.key === "ALL" ? "ALL" : option.stages[0])} className="h-auto justify-between py-2"><span>{option.label}</span><span>{count}</span></Button>;
        })}
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
              <option value="whatsapp">WhatsApp</option>
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
      {voiceCallMessage ? <div className="text-sm text-emerald-700 flex items-center gap-2"><Phone className="w-4 h-4" /> {voiceCallMessage}</div> : null}

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
                <th className="px-3 py-2 text-left">Next follow-up / Actions</th>
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
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px]"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{lead.source || "manual"}</span>{lead.member_user_id || lead.partner_request_id || lead.converted_partner_id ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">Registration linked</span> : null}</div>
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
                    <div className="flex items-center gap-2">{lead.next_follow_up_at ? new Date(lead.next_follow_up_at).toLocaleString() : "-"} <ArrowUpRight className="w-4 h-4 text-slate-400" /></div>
                    <div className="mt-1 text-xs text-slate-500">Follow-up: {lead.follow_up_status || "Pending"}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => openLeadDetails(lead)} title="View lead timeline"><Eye className="w-3.5 h-3.5 mr-1" /> Details</Button>
                      <Button size="sm" variant="outline" onClick={() => startVoiceCall(lead)} disabled={voiceCallBusyId === lead.id || Boolean(voiceCallBusyId)} title="Start voice call">
                        <PhoneCall className="w-3.5 h-3.5 mr-1" /> {voiceCallBusyId === lead.id ? "Calling..." : "Voice call"}
                      </Button>
                    </div>
                    {(["QUALIFIED", "APPLICATION", "APPROVED"].includes(lead.status) && !lead.partner_request_id && !lead.partner_id && !lead.converted_partner_id) ? (
                      <Button size="sm" variant="outline" className="mt-2" onClick={() => openConversion(lead)}><ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> Convert to Partner</Button>
                    ) : null}
                    {lead.status === "LOST" ? <Button size="sm" variant="outline" className="mt-2 text-red-700" onClick={() => deleteLostLead(lead)}><Trash2 className="w-3.5 h-3.5 mr-1" /> Delete rejected</Button> : null}
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

      <Dialog open={Boolean(detailLead)} onOpenChange={(open) => { if (!open) setDetailLead(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Lead timeline: {detailLead?.business_name}</DialogTitle><DialogDescription>এখানে WhatsApp, CRM follow-up, stage এবং registration-এর সম্পূর্ণ history দেখা যাবে।</DialogDescription></DialogHeader>
          {detailLead ? <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><div><span className="text-xs text-slate-500">Source</span><p>{detailLead.source || "manual"}</p></div><div><span className="text-xs text-slate-500">Phone</span><p>{detailLead.phone || detailLead.whatsapp_no || "-"}</p></div><div><span className="text-xs text-slate-500">Stage</span><select value={detailLead.status || "NEW"} onChange={(event) => updateLeadStage(event.target.value)} className="mt-1 w-full rounded-md border border-input px-2 py-1 text-xs">{stageOptions.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></div><div><span className="text-xs text-slate-500">Registration</span><p>{detailLead.member_user_id || detailLead.partner_request_id || detailLead.converted_partner_id ? "Linked" : "Not linked"}</p></div></div>
            <div className="border-t pt-3"><h3 className="font-semibold">Follow-ups</h3>{detailLoading ? <p className="mt-2 text-slate-500">Loading...</p> : detailFollowups.length ? <div className="mt-2 space-y-2">{detailFollowups.map((followup) => <div key={followup.id} className="flex justify-between rounded border p-2"><span>{followup.notes || "CRM follow-up"}</span><span className="text-xs text-slate-500">{followup.status} · {followup.scheduled_at ? new Date(followup.scheduled_at).toLocaleString() : "-"}</span></div>)}</div> : <p className="mt-2 text-slate-500">No follow-up recorded</p>}</div>
            <div className="border-t pt-3"><h3 className="font-semibold">Activity timeline</h3>{detailLoading ? null : detailActivities.length ? <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{detailActivities.map((activity) => <div key={activity.id} className="rounded border p-2"><div className="flex justify-between gap-3"><span className="font-medium">{activity.activity_type}</span><span className="text-xs text-slate-500">{activity.created_at ? new Date(activity.created_at).toLocaleString() : ""}</span></div><p className="mt-1 whitespace-pre-wrap text-slate-600">{activity.message}</p></div>)}</div> : <p className="mt-2 text-slate-500">No activity recorded</p>}</div>
          </div> : null}
          <DialogFooter><Button variant="outline" onClick={() => setDetailLead(null)}>Close</Button>{detailLead?.status === "LOST" ? <Button variant="outline" className="text-red-700" onClick={() => deleteLostLead(detailLead)}><Trash2 className="mr-1 h-4 w-4" />Delete rejected</Button> : null}</DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

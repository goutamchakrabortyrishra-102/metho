import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/services/api";

export default function CEODashboardPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/admin/ceo-dashboard").then(({ data }) => setData(data)).catch(() => setData(null));
  }, []);

  if (!data) {
    return <div className="bg-white rounded-xl border border-border p-6 text-slate-500">Loading CEO dashboard...</div>;
  }

  const classification = [
    ["New", ["NEW"]],
    ["Old / Contacted", ["CONTACTED"]],
    ["Interested", ["INTERESTED", "QUALIFIED"]],
    ["Registration started", ["APPLICATION"]],
    ["Completed", ["APPROVED", "CONVERTED"]],
    ["Reject / Lost", ["LOST"]],
  ].map(([label, stages]) => ({ label, count: (data.stage_breakdown || []).filter((item) => stages.includes(item.stage)).reduce((sum, item) => sum + item.count, 0), whatsapp: (data.stage_breakdown || []).filter((item) => stages.includes(item.stage)).reduce((sum, item) => sum + (item.whatsapp_count || 0), 0) }));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">CEO Dashboard</p>
        <h1 className="text-2xl font-bold text-slate-900">Executive overview</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">WhatsApp CRM leads</p><p className="text-2xl font-bold text-emerald-800">{data.whatsapp_leads || 0}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">WhatsApp messages</p><p className="text-2xl font-bold">{data.whatsapp_messages || 0}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">WhatsApp pending follow-ups</p><p className="text-2xl font-bold text-amber-600">{data.whatsapp_pending_followups || 0}</p></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Link to="/admin/crm/leads?status=APPLICATION" className="bg-white rounded-xl border border-border p-4 hover:bg-emerald-50"><p className="text-xs uppercase text-slate-500">Registration started</p><p className="text-2xl font-bold text-emerald-800">{data.whatsapp_registration_started || 0}</p></Link>
        <Link to="/admin/crm/leads?status=APPROVED" className="bg-white rounded-xl border border-border p-4 hover:bg-emerald-50"><p className="text-xs uppercase text-slate-500">Registration completed</p><p className="text-2xl font-bold text-emerald-800">{data.whatsapp_registration_completed || 0}</p></Link>
        <Link to="/admin/crm/whatsapp" className="bg-white rounded-xl border border-border p-4 hover:bg-emerald-50"><p className="text-xs uppercase text-slate-500">Executive handoff</p><p className="text-2xl font-bold text-amber-600">{data.whatsapp_human_handoffs || 0}</p></Link>
        <Link to="/admin/crm/whatsapp" className="bg-white rounded-xl border border-border p-4 hover:bg-red-50"><p className="text-xs uppercase text-slate-500">No reply after reminders</p><p className="text-2xl font-bold text-red-600">{data.whatsapp_no_response_after_reminders || 0}</p></Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-border p-4"><h2 className="font-semibold mb-3">Lead classification</h2><div className="grid grid-cols-2 gap-2 text-sm">{classification.map((item) => <Link key={item.label} to={`/admin/crm/leads?status=${item.label === "Reject / Lost" ? "LOST" : item.label === "Registration started" ? "APPLICATION" : item.label === "Interested" ? "INTERESTED" : item.label === "Completed" ? "CONVERTED" : item.label === "Old / Contacted" ? "CONTACTED" : "NEW"}`} className="rounded border p-2 hover:bg-emerald-50"><span className="font-semibold">{item.label}</span><span className="block text-slate-600">{item.count} total · {item.whatsapp} WhatsApp</span></Link>)}</div></div>
        <div className="bg-white rounded-xl border border-border p-4"><h2 className="font-semibold mb-3">Lead source breakup</h2><div className="space-y-2 text-sm">{(data.source_breakdown || []).map((item) => <div key={item.source} className="flex justify-between rounded border p-2"><span>{item.source}</span><span className="font-semibold">{item.count}</span></div>)}</div></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">Today sales</p><p className="text-2xl font-bold">{data.today_sales}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">Monthly sales</p><p className="text-2xl font-bold">{data.monthly_sales}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">New leads</p><p className="text-2xl font-bold">{data.new_leads}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">Conversion</p><p className="text-2xl font-bold">{data.conversion_rate}%</p></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/admin/orders" className="bg-white rounded-xl border border-amber-200 p-4 hover:bg-amber-50"><p className="text-xs uppercase text-slate-500">Order action needed</p><p className="text-2xl font-bold text-amber-700">{data.pending_orders || 0}</p><p className="mt-1 text-xs text-slate-600">payment / approval queue</p></Link>
        <Link to="/admin/orders" className="bg-white rounded-xl border border-red-200 p-4 hover:bg-red-50"><p className="text-xs uppercase text-slate-500">Paid invoice review</p><p className="text-2xl font-bold text-red-700">{data.paid_orders_without_invoice || 0}</p><p className="mt-1 text-xs text-slate-600">paid orders without invoice record</p></Link>
        <Link to="/admin/withdrawals" className="bg-white rounded-xl border border-amber-200 p-4 hover:bg-amber-50"><p className="text-xs uppercase text-slate-500">Withdrawal action needed</p><p className="text-2xl font-bold text-amber-700">{data.pending_withdrawals || 0}</p><p className="mt-1 text-xs text-slate-600">verify before payout</p></Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-border p-4"><h2 className="font-semibold mb-3">Operations</h2><ul className="space-y-2 text-sm text-slate-700"><li>Members: {data.new_members} new / {data.active_members} active</li><li>Partners: {data.new_partners} new / {data.active_partners} active</li><li>Total orders: {data.total_orders}</li></ul></div>
        <div className="bg-white rounded-xl border border-border p-4"><h2 className="font-semibold mb-3">Pipeline</h2><ul className="space-y-2 text-sm text-slate-700"><li>Hot leads: {data.hot_leads}</li><li>Pending follow-ups: {data.pending_followups}</li><li>Overdue follow-ups: {data.overdue_followups}</li></ul></div>
      </div>
      {data.whatsapp_action_queue?.length ? <div className="bg-white rounded-xl border border-border p-4"><h2 className="font-semibold mb-3">Priority actions</h2><div className="space-y-2">{data.whatsapp_action_queue.map((item) => <Link key={`${item.lead_id || item.order_id}-${item.reason}`} to={item.route ? item.route.replace(/^\/app/, "/admin") : `/admin/crm/leads?search=${encodeURIComponent(item.phone || item.name)}`} className="flex items-center justify-between gap-3 rounded border p-3 hover:bg-emerald-50"><span><span className="block font-semibold">{item.name || "WhatsApp lead"}</span><span className="text-xs text-slate-600">{item.phone ? `${item.phone} · ` : ""}{item.reason}</span></span><span className="text-xs font-semibold text-red-700">Open</span></Link>)}</div></div> : null}
    </div>
  );
}

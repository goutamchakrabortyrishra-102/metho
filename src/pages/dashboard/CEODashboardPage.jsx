import React, { useEffect, useState } from "react";
import api from "@/services/api";

export default function CEODashboardPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/admin/ceo-dashboard").then(({ data }) => setData(data)).catch(() => setData(null));
  }, []);

  if (!data) {
    return <div className="bg-white rounded-xl border border-border p-6 text-slate-500">Loading CEO dashboard...</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">CEO Dashboard</p>
        <h1 className="text-2xl font-bold text-slate-900">Executive overview</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">Today sales</p><p className="text-2xl font-bold">{data.today_sales}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">Monthly sales</p><p className="text-2xl font-bold">{data.monthly_sales}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">New leads</p><p className="text-2xl font-bold">{data.new_leads}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">Conversion</p><p className="text-2xl font-bold">{data.conversion_rate}%</p></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-border p-4"><h2 className="font-semibold mb-3">Operations</h2><ul className="space-y-2 text-sm text-slate-700"><li>Members: {data.new_members} new / {data.active_members} active</li><li>Partners: {data.new_partners} new / {data.active_partners} active</li><li>Total orders: {data.total_orders}</li></ul></div>
        <div className="bg-white rounded-xl border border-border p-4"><h2 className="font-semibold mb-3">Pipeline</h2><ul className="space-y-2 text-sm text-slate-700"><li>Hot leads: {data.hot_leads}</li><li>Pending follow-ups: {data.pending_followups}</li><li>Overdue follow-ups: {data.overdue_followups}</li></ul></div>
      </div>
    </div>
  );
}

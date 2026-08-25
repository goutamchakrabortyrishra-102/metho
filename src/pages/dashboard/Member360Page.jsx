import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "@/services/api";

export default function Member360Page() {
  const { memberId } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!memberId) return;
    api.get(`/admin/members/${memberId}/360`).then(({ data }) => setData(data)).catch(() => setData(null));
  }, [memberId]);

  if (!data) {
    return <div className="bg-white rounded-xl border border-border p-6 text-slate-500">Loading member profile...</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Member 360</p>
        <h1 className="text-2xl font-bold text-slate-900">{data.profile?.name}</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">Member code</p><p className="text-xl font-bold">{data.profile?.member_code}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">Phone</p><p className="text-xl font-bold">{data.profile?.phone}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs uppercase text-slate-500">Join date</p><p className="text-xl font-bold">{data.profile?.join_date}</p></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-border p-4">
          <h2 className="font-semibold mb-3">Business & Orders</h2>
          <ul className="space-y-2 text-sm text-slate-700">
            <li>Total orders: {data.business?.total_orders}</li>
            <li>Completed orders: {data.business?.completed_orders}</li>
            <li>Total purchase: {data.business?.total_purchase}</li>
          </ul>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <h2 className="font-semibold mb-3">CRM</h2>
          <ul className="space-y-2 text-sm text-slate-700">
            <li>Lead status: {data.crm?.lead_status || "-"}</li>
            <li>Next follow-up: {data.crm?.next_follow_up || "-"}</li>
            <li>Last contact: {data.crm?.last_contact || "-"}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

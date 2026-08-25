import React, { useEffect, useState } from "react";
import api from "@/services/api";

const stages = ["NEW", "CONTACTED", "INTERESTED", "QUALIFIED", "APPLICATION", "APPROVED", "CONVERTED", "LOST"];

export default function CRMPipelinePage() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.get("/admin/crm/pipeline").then(({ data }) => setItems(data?.stages || [])).catch(() => setItems([]));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">METHO CRM</p>
        <h1 className="text-2xl font-bold text-slate-900">Pipeline</h1>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {stages.map((stage) => {
          const item = items.find((row) => row.stage === stage) || { count: 0 };
          return (
            <div key={stage} className="bg-white rounded-xl border border-border p-4">
              <p className="text-xs uppercase text-slate-500">{stage}</p>
              <p className="text-3xl font-bold text-slate-900 mt-2">{item.count}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

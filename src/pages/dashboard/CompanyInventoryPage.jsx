import React, { useEffect, useState } from "react";
import { AlertTriangle, Boxes, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

const inr = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function CompanyInventoryPage() {
  const { user } = useAuth();
  const isAdmin = user && ["super_admin", "company_admin", "admin"].includes(user.role);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get("/admin/company-inventory");
      setData(response.data || { summary: {}, items: [] });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Company inventory could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/app" replace />;
  const summary = data?.summary || {};
  const items = Array.isArray(data?.items) ? data.items : [];

  return (
    <div className="space-y-6" data-testid="company-inventory-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Company Inventory</h1>
          <p className="text-sm text-muted-foreground mt-1">Main company stock only. METHO Store inventory is managed separately.</p>
        </div>
        <Button type="button" variant="outline" className="rounded-full" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Summary label="Total Products" value={summary.total_products || 0} />
        <Summary label="Company Units" value={summary.total_company_units || 0} />
        <Summary label="Purchase Value" value={inr(summary.total_purchase_value)} />
        <Summary label="Low Stock" value={summary.low_stock || 0} tone="amber" />
        <Summary label="Out of Stock" value={summary.out_of_stock || 0} tone="red" />
        <Summary label="Potential Margin" value={inr(summary.potential_stock_margin)} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="bg-emerald-900 text-white">
            <tr>
              {['Product', 'SKU', 'Purchase Cost', 'Price Before GST', 'GST', 'Final Price', 'Company Stock', 'Purchase Value', 'Selling Value', 'Margin', 'Status'].map((label) => <th key={label} className="px-3 py-3 text-left text-xs uppercase tracking-wider">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => (
              <tr key={item.product_id}>
                <td className="px-3 py-3 font-semibold text-emerald-950">{item.name}</td>
                <td className="px-3 py-3 font-mono text-xs text-slate-600">{item.sku || "-"}</td>
                <td className="px-3 py-3">{inr(item.purchase_cost)}</td>
                <td className="px-3 py-3">{inr(item.price_before_gst)}</td>
                <td className="px-3 py-3">{item.gst_percent}% · {inr(item.gst_amount)}</td>
                <td className="px-3 py-3 font-bold text-emerald-800">{inr(item.final_price)}</td>
                <td className="px-3 py-3 font-bold">{item.company_stock}</td>
                <td className="px-3 py-3">{inr(item.purchase_value)}</td>
                <td className="px-3 py-3">{inr(item.selling_value)}</td>
                <td className="px-3 py-3">{inr(item.potential_margin)}</td>
                <td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${item.stock_status === "out_of_stock" ? "bg-red-100 text-red-700" : item.stock_status === "low_stock" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{item.stock_status === "low_stock" || item.stock_status === "out_of_stock" ? <AlertTriangle className="w-3 h-3" /> : <Boxes className="w-3 h-3" />} {item.stock_status.replaceAll("_", " ")}</span></td>
              </tr>
            ))}
            {!loading && items.length === 0 ? <tr><td colSpan="11" className="px-4 py-10 text-center text-slate-500">No company products found.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Summary({ label, value, tone = "emerald" }) {
  const colors = tone === "red" ? "border-red-200 text-red-700" : tone === "amber" ? "border-amber-200 text-amber-700" : "border-border text-emerald-950";
  return <div className={`rounded-xl border bg-white p-4 ${colors}`}><p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</p><p className="font-display font-black text-xl mt-1">{value}</p></div>;
}

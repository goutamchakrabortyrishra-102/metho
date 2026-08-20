import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileDown, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import AddProductDialog from "@/components/AddProductDialog";
import { Button } from "@/components/ui/button";
import { getGstInclusivePrice } from "@/lib/utils";

const unitFor = (item) => ["kg", "gram", "piece"].includes(String(item?.unit_type || "").toLowerCase()) ? String(item.unit_type).toLowerCase() : "piece";
const stockFor = (item) => Math.max(0, Number(item?.stock || 0));

export default function MethoVegetableInventoryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/products", { params: { refresh: Date.now() } });
      setItems((Array.isArray(data) ? data : []).filter((item) => String(item?.product_type || "").toLowerCase() === "metho_vegetable"));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Vegetable inventory could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  const lowStockCount = useMemo(() => items.filter((item) => {
    const unit = unitFor(item);
    const stock = stockFor(item);
    return stock <= 0 || (unit === "piece" ? stock <= 5 : unit === "kg" ? stock <= 1 : stock <= 1000);
  }).length, [items]);

  const downloadPdf = async () => {
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      doc.setFontSize(16); doc.text("METHO Vegetable Inventory", 14, 16);
      doc.setFontSize(9); doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, 14, 23);
      let y = 34;
      items.forEach((item, index) => {
        if (y > 280) { doc.addPage(); y = 18; }
        const unit = unitFor(item);
        const rate = getGstInclusivePrice(item?.price, Number(item?.gst_percent || 0));
        doc.text(`${index + 1}. ${item.name} | ${item.category || "Other"}`, 14, y);
        doc.text(`Rate: Rs ${rate}/${unit === "piece" ? "pc" : unit} | Stock: ${stockFor(item)} ${unit === "piece" ? "pc" : unit}`, 18, y + 5);
        y += 12;
      });
      doc.save(`METHO_Vegetable_Inventory_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success("Inventory PDF downloaded");
    } catch {
      toast.error("Inventory PDF could not be generated");
    }
  };

  return <div className="space-y-6" data-testid="vegetable-inventory-page">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><Link to="/app/metho-vegetable-admin?type=metho_vegetable" className="inline-flex items-center text-sm font-semibold text-emerald-900 hover:underline"><ArrowLeft className="mr-1 h-4 w-4" /> Vegetables</Link><h1 className="mt-2 font-display text-3xl font-black text-emerald-950">Vegetable Inventory</h1><p className="mt-1 text-sm text-slate-600">Daily rate ও stock এখান থেকে edit করুন।</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={load} className="rounded-full"><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button><Button onClick={downloadPdf} className="rounded-full bg-emerald-900 hover:bg-emerald-950"><FileDown className="mr-2 h-4 w-4" /> Download PDF</Button></div>
    </div>
    <div className="flex gap-2 text-xs font-semibold"><span className="rounded-full bg-emerald-100 px-3 py-1.5 text-emerald-900">{items.length} items</span><span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900">{lowStockCount} low stock</span></div>
    <div className="overflow-x-auto border border-emerald-200 bg-white"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-emerald-50 text-xs uppercase tracking-wider text-emerald-800"><tr><th className="px-4 py-3">Vegetable</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Rate</th><th className="px-4 py-3">Stock</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Edit</th></tr></thead><tbody className="divide-y divide-emerald-100">{items.map((item) => { const unit = unitFor(item); const stock = stockFor(item); const rate = getGstInclusivePrice(item?.price, Number(item?.gst_percent || 0)); const low = stock <= 0 || (unit === "piece" ? stock <= 5 : unit === "kg" ? stock <= 1 : stock <= 1000); return <tr key={item.id}><td className="px-4 py-3 font-semibold text-emerald-950">{item.name}</td><td className="px-4 py-3">{item.category}</td><td className="px-4 py-3">Rs {rate}/{unit === "piece" ? "pc" : unit}</td><td className="px-4 py-3 font-semibold">{stock} {unit === "piece" ? "pc" : unit}</td><td className="px-4 py-3"><span className={"rounded-full px-2.5 py-1 text-xs font-semibold " + (item.hidden ? "bg-slate-100 text-slate-600" : low ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800")}>{item.hidden ? "Hidden" : low ? "Low Stock" : "Available"}</span></td><td className="px-4 py-3 text-right"><Button size="sm" variant="outline" className="rounded-full" onClick={() => setEditingProduct(item)}><Pencil className="mr-1 h-3.5 w-3.5" /> Edit</Button></td></tr>; })}{!loading && items.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No vegetable inventory found.</td></tr> : null}</tbody></table></div>
    <AddProductDialog open={!!editingProduct} onOpenChange={(open) => !open && setEditingProduct(null)} product={editingProduct} onCreated={load} showTrigger={false} defaultProductType="metho_vegetable" />
  </div>;
}
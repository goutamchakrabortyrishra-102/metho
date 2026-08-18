import React, { useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Pencil, Plus, Printer, RefreshCw, Search } from "lucide-react";
import { Navigate, Link } from "react-router-dom";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { buildReportPdf, buildReportWorkbook } from "@/lib/partnerReports";
import { isDeliveryServiceLike, isPropertyServiceLike, isTransportServiceLike } from "@/lib/partnerSector";

const SECTORS = {
  product: { label: "PRODUCT INVENTORY", report: "products", fields: ["Name", "Category", "Price", "Current Stock", "Status"] },
  service: { label: "SERVICE INVENTORY", report: "services", fields: ["Name", "Category", "Rate", "Availability", "Status"] },
  transport: { label: "TRANSPORT / FLEET", report: "transport", fields: ["Vehicle", "Vehicle Number", "Type", "Fare", "Status"] },
  courier: { label: "COURIER / LOGISTICS", report: "courier", fields: ["Service", "Coverage", "Rate", "Delivery Status", "Status"] },
  property: { label: "PROPERTY / LAND", report: "property", fields: ["Property", "Type", "Listing", "Price", "Status"] },
};

const isService = (item) => Boolean(item?.is_service || String(item?.listing_type || item?.item_kind || "").toLowerCase() === "service");
const sectorFor = (item) => {
  if (!isService(item)) return "product";
  if (isPropertyServiceLike(item)) return "property";
  if (isDeliveryServiceLike(item)) return "courier";
  if (isTransportServiceLike(item)) return "transport";
  return "service";
};
const statusFor = (sector, item) => {
  if (sector === "product") return item.stock_status || (Number(item.current_stock ?? item.stock) > 0 ? "IN STOCK" : "OUT OF STOCK");
  if (sector === "property") return item.property_status || "AVAILABLE";
  if (sector === "transport") return item.vehicle_status || item.availability || "AVAILABLE";
  if (sector === "courier") return item.availability || item.delivery_status || "AVAILABLE";
  return item.availability || (item.is_available === false ? "UNAVAILABLE" : "AVAILABLE");
};
const toReportRow = (sector, item) => {
  if (sector === "product") return { product: item.name, sku: item.sku || item.product_code || "", category: item.category, purchase_cost: Number(item.purchase_cost || 0), price_before_gst: Number(item.price_before_gst || item.price || 0), gst_percent: Number(item.gst_percent || 0), gst_amount: Number(item.gst_amount || 0), final_price: Number(item.final_price || item.price || 0), opening_stock: Number(item.opening_stock || 0), current_stock: Math.max(0, Number(item.current_stock ?? item.stock ?? 0)), sold: Number(item.sold_quantity || 0), available: Math.max(0, Number(item.current_stock ?? item.stock ?? 0)), stock_status: statusFor(sector, item), revenue: Number(item.revenue || 0) };
  if (sector === "service") return { service: item.name, sector: item.service_sector || "Service", category: item.category, rate: Number(item.price_before_gst || item.price || 0), gst_percent: Number(item.gst_percent || 0), gst_amount: Number(item.gst_amount || 0), final_rate: Number(item.final_price || item.price || 0), service_area: item.service_area || "", availability: statusFor(sector, item), revenue: Number(item.revenue || 0) };
  if (sector === "transport") return { vehicle: item.name, vehicle_number: item.vehicle_number || "", vehicle_type: item.vehicle_type || "", capacity: Number(item.seating_capacity || item.capacity || 0), base_fare: Number(item.base_fare || item.price || 0), per_km_rate: Number(item.per_km_rate || 0), gst_percent: Number(item.gst_percent || 0), gst_amount: Number(item.gst_amount || 0), final_fare: Number(item.final_price || item.price || 0), bookings: Number(item.booking_count || 0), active_trips: Number(item.active_trips || 0), completed_trips: Number(item.completed_trips || 0), cancelled_trips: Number(item.cancelled_trips || 0), availability: statusFor(sector, item), revenue: Number(item.revenue || 0) };
  if (sector === "courier") return { booking_id: item.id, courier_service: item.name, pickup: item.pickup_area || item.service_area || "", delivery: item.delivery_area || "", delivery_charge: Number(item.price_before_gst || item.price || 0), gst_percent: Number(item.gst_percent || 0), gst_amount: Number(item.gst_amount || 0), final_amount: Number(item.final_price || item.price || 0), payment_status: item.payment_status || "", delivery_status: item.delivery_status || statusFor(sector, item), revenue: Number(item.revenue || 0) };
  return { property: item.name, property_type: item.property_type || "", listing_type: item.property_listing_type || "", area: Number(item.property_area || 0), area_unit: item.property_area_unit || "", location: item.property_location || item.service_area || "", district: item.district || "", city: item.city || "", price: Number(item.price || 0), status: statusFor(sector, item), enquiries: Number(item.enquiry_count || 0) };
};

export default function PartnerInventoryPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [sector, setSector] = useState("product");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const load = () => {
    setLoading(true);
    api.get("/partner/inventory").then((response) => setItems(Array.isArray(response.data?.items) ? response.data.items : [])).catch((error) => toast.error(error?.response?.data?.detail || "Inventory could not be loaded")).finally(() => setLoading(false));
  };
  useEffect(() => { if (user?.role === "partner") load(); }, [user]);
  const rows = useMemo(() => items.filter((item) => sectorFor(item) === sector).filter((item) => status === "all" || statusFor(sector, item).toLowerCase() === status.toLowerCase()).filter((item) => !search.trim() || JSON.stringify(item).toLowerCase().includes(search.trim().toLowerCase())), [items, sector, search, status]);
  if (!user) return <div className="p-8 text-center">Loading...</div>;
  if (user.role !== "partner") return <Navigate to="/app" replace />;
  const config = SECTORS[sector];
  const reportRows = rows.map((item) => toReportRow(sector, item));
  const exportPdf = () => buildReportPdf(config.report, reportRows).save(`Partner_${config.report}_Inventory.pdf`);
  const exportExcel = () => XLSX.writeFile(buildReportWorkbook(config.report, reportRows), `Partner_${config.report}_Inventory.xlsx`);
  return <div className="space-y-5" data-testid="partner-inventory-page">
    <div className="flex flex-wrap items-end justify-between gap-3 print:hidden"><div><p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Partner Inventory</p><h1 className="font-display font-black text-3xl text-emerald-950">{config.label}</h1><p className="text-sm text-slate-600">Sector-specific listings only · {rows.length} visible</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={load} disabled={loading}><RefreshCw className="w-4 h-4 mr-2" /> Refresh</Button><Button variant="outline" onClick={exportPdf}><FileDown className="w-4 h-4 mr-2" /> PDF</Button><Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 mr-2" /> Excel</Button><Button variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" /> Print</Button><Link to="/partner?tab=overview"><Button><Plus className="w-4 h-4 mr-2" /> Add</Button></Link></div></div>
    <div className="flex flex-wrap gap-2 print:hidden">{Object.entries(SECTORS).map(([key, value]) => <button key={key} type="button" onClick={() => { setSector(key); setStatus("all"); setSearch(""); }} className={`rounded-full border px-3 py-2 text-xs font-semibold ${sector === key ? "border-emerald-900 bg-emerald-900 text-white" : "border-emerald-200 bg-white text-emerald-900"}`}>{value.label}</button>)}</div>
    <div className="flex flex-wrap gap-2 print:hidden"><div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search inventory" className="pl-9" /></div><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border border-input bg-white px-3 text-sm"><option value="all">All statuses</option>{[...new Set(items.filter((item) => sectorFor(item) === sector).map((item) => statusFor(sector, item)))].filter(Boolean).map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
    <div className="overflow-x-auto rounded-xl border border-border bg-white"><table className="min-w-full text-sm"><thead className="bg-emerald-900 text-white"><tr>{config.fields.map((field) => <th key={field} className="px-3 py-3 text-left whitespace-nowrap">{field}</th>)}<th className="px-3 py-3 text-left print:hidden">Actions</th></tr></thead><tbody className="divide-y divide-border">{rows.map((item) => <tr key={item.id}><td className="px-3 py-3 font-semibold">{item.name}</td><td className="px-3 py-3">{item.category || item.service_sector || item.property_type || "-"}</td><td className="px-3 py-3">{sector === "product" ? `${item.current_stock ?? item.stock ?? 0}` : sector === "property" ? `INR ${Number(item.price || 0).toLocaleString("en-IN")}` : `INR ${Number(item.price || 0).toLocaleString("en-IN")}`}</td><td className="px-3 py-3">{sector === "product" ? Math.max(0, Number(item.current_stock ?? item.stock ?? 0)) : item.availability || item.vehicle_status || item.delivery_status || item.property_status || "-"}</td><td className="px-3 py-3"><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">{statusFor(sector, item)}</span></td><td className="px-3 py-3 print:hidden"><Link to={`/partner?tab=${sector === "product" ? "products" : sector === "transport" ? "transport" : sector === "courier" ? "delivery-partner" : sector === "property" ? "property-buy-sell" : "services"}`} className="inline-flex items-center text-emerald-800 hover:underline"><Pencil className="mr-1 h-3.5 w-3.5" /> Edit</Link></td></tr>)}{rows.length === 0 ? <tr><td colSpan={config.fields.length + 1} className="px-4 py-10 text-center text-slate-500">No {config.label.toLowerCase()} records found.</td></tr> : null}</tbody></table></div>
    <style>{`@media print { aside, header, .partner-inventory-page button, .partner-inventory-page select, .partner-inventory-page input, .partner-inventory-page a { display: none !important; } .partner-inventory-page { margin: 0 !important; padding: 0 !important; } }`}</style>
  </div>;
}

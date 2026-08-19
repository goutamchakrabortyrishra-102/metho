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
import PartnerProductForm from "@/components/PartnerProductForm";
import { inferPartnerPrimarySector, isDeliveryServiceLike, isPropertyServiceLike, isTransportServiceLike, PARTNER_SECTOR_KEYS } from "@/lib/partnerSector";

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
const editConfigFor = (sector) => {
  if (sector === "transport") return { allowedServiceSectors: ["Transport"], initialServiceSectorFilter: "Transport", fixedListingType: "service" };
  if (sector === "courier") return { allowedServiceSectors: ["Delivery Partner"], initialServiceSectorFilter: "Delivery Partner", fixedListingType: "service" };
  if (sector === "property") return { allowedServiceSectors: ["Property Buy & Sell", "Real Estate"], initialServiceSectorFilter: "Property Buy & Sell", fixedListingType: "service" };
  if (sector === "service") return { fixedListingType: "service" };
  return { fixedListingType: "product" };
};
const inventorySectorForPrimary = (primarySector) => {
  if (primarySector === PARTNER_SECTOR_KEYS.PRODUCT_SECTOR) return "product";
  if (primarySector === PARTNER_SECTOR_KEYS.TRANSPORT_SECTOR) return "transport";
  if (primarySector === PARTNER_SECTOR_KEYS.DELIVERY_PARTNER_SECTOR) return "courier";
  if (primarySector === PARTNER_SECTOR_KEYS.PROPERTY_SECTOR) return "property";
  return "service";
};

export default function PartnerInventoryPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [partnerSummary, setPartnerSummary] = useState(null);
  const [sector, setSector] = useState("product");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = () => {
    setLoading(true);
    setError("");
    api.get("/partner/inventory").then((response) => {
      const nextItems = Array.isArray(response.data?.items) ? response.data.items.filter((item) => item && typeof item === "object") : [];
      setItems(nextItems);
    }).catch((requestError) => {
      setItems([]);
      setError(requestError?.response?.data?.detail || "Unable to load inventory");
      toast.error(requestError?.response?.data?.detail || "Inventory could not be loaded");
    }).finally(() => setLoading(false));
  };
  useEffect(() => {
    if (user?.role !== "partner") return;
    load();
    api.get("/partner/summary").then((response) => setPartnerSummary(response.data || null)).catch(() => setPartnerSummary(null));
  }, [user]);
  const primarySector = useMemo(() => {
    const counts = items.reduce((result, item) => {
      const key = sectorFor(item);
      result.products += key === "product" ? 1 : 0;
      result.transport += key === "transport" ? 1 : 0;
      result.delivery += key === "courier" ? 1 : 0;
      result.property += key === "property" ? 1 : 0;
      result.otherServices += key === "service" ? 1 : 0;
      return result;
    }, { products: 0, transport: 0, delivery: 0, property: 0, otherServices: 0 });
    return inferPartnerPrimarySector({ businessType: partnerSummary?.business_type, businessName: partnerSummary?.business_name, counts });
  }, [items, partnerSummary]);
  const inventorySector = inventorySectorForPrimary(primarySector);
  useEffect(() => { setSector(inventorySector); }, [inventorySector]);
  const rows = useMemo(() => items.filter((item) => sectorFor(item) === sector).filter((item) => status === "all" || statusFor(sector, item).toLowerCase() === status.toLowerCase()).filter((item) => !search.trim() || JSON.stringify(item).toLowerCase().includes(search.trim().toLowerCase())), [items, sector, search, status]);
  if (!user) return <div className="p-8 text-center">Loading...</div>;
  if (user.role !== "partner") return <Navigate to="/app" replace />;
  const config = SECTORS[sector] || SECTORS.product;
  const reportRows = rows.map((item) => toReportRow(sector, item));
  const exportPdf = () => buildReportPdf(config.report, reportRows).save(`Partner_${config.report}_Inventory.pdf`);
  const exportExcel = () => XLSX.writeFile(buildReportWorkbook(config.report, reportRows), `Partner_${config.report}_Inventory.xlsx`);
  return <div className="partner-inventory-page space-y-5" data-testid="partner-inventory-page">
    {loading ? <div className="rounded-xl border border-emerald-200 bg-white p-6 text-sm text-slate-600" data-testid="inventory-loading">Loading inventory...</div> : null}
    {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" data-testid="inventory-error"><p>{error}</p><Button type="button" className="mt-3" onClick={load}>Retry</Button></div> : null}
    <div className="flex flex-wrap items-end justify-between gap-3 print:hidden"><div><p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Partner Inventory</p><h1 className="font-display font-black text-3xl text-emerald-950">{config.label}</h1><p className="text-sm text-slate-600">Sector-specific listings only · {rows.length} visible</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={load} disabled={loading}><RefreshCw className="w-4 h-4 mr-2" /> Refresh</Button><Button variant="outline" onClick={exportPdf}><FileDown className="w-4 h-4 mr-2" /> PDF</Button><Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 mr-2" /> Excel</Button><Button variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" /> Print</Button><PartnerProductForm onSaved={load} {...editConfigFor(sector)} triggerLabel="Add" dialogTitle={`Add ${config.label.toLowerCase()}`} dialogDescription="Create a new listing. The inventory list will refresh automatically." /></div></div>
    <div className="flex flex-wrap gap-2 print:hidden"><span className="rounded-full border border-emerald-900 bg-emerald-900 px-3 py-2 text-xs font-semibold text-white">{config.label}</span></div>
    <div className="flex flex-wrap gap-2 print:hidden"><div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search inventory" className="pl-9" /></div><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border border-input bg-white px-3 text-sm"><option value="all">All statuses</option>{[...new Set(items.filter((item) => sectorFor(item) === sector).map((item) => statusFor(sector, item)))].filter(Boolean).map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
    <div className="overflow-x-auto rounded-xl border border-border bg-white"><table className="min-w-full text-sm"><thead className="bg-emerald-900 text-white"><tr>{config.fields.map((field) => <th key={field} className="px-3 py-3 text-left whitespace-nowrap">{field}</th>)}<th className="px-3 py-3 text-left print:hidden">Actions</th></tr></thead><tbody className="divide-y divide-border">{rows.map((item) => { const editable = { ...item, id: item.item_id, stock: item.current_stock ?? item.stock ?? "", opening_stock: item.opening_stock ?? item.current_stock ?? item.stock ?? "", price: item.price_before_gst ?? item.price ?? "" }; const editConfig = editConfigFor(sector); return <tr key={item.item_id || item.id}><td className="px-3 py-3 font-semibold">{item.name || "Unnamed listing"}</td><td className="px-3 py-3">{item.category || item.service_sector || item.property_type || "-"}</td><td className="px-3 py-3">{sector === "product" ? `₹${Number(item.price_before_gst ?? item.price ?? 0).toFixed(2)}` : `₹${Number(item.price_before_gst ?? item.price ?? 0).toFixed(2)}`}</td><td className="px-3 py-3">{sector === "product" ? Math.max(0, Number(item.current_stock ?? item.stock ?? 0)) : item.availability || item.vehicle_status || item.delivery_status || item.property_status || "-"}</td><td className="px-3 py-3"><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">{statusFor(sector, item)}</span></td><td className="px-3 py-3 print:hidden"><PartnerProductForm product={editable} onSaved={load} {...editConfig} triggerLabel="Edit" dialogTitle={`Edit ${config.label.toLowerCase()}`} dialogDescription="Update fields and save. The inventory list will refresh automatically." /></td></tr>; })}{!loading && !error && rows.length === 0 ? <tr><td colSpan={config.fields.length + 1} className="px-4 py-10 text-center text-slate-500">No inventory found.</td></tr> : null}</tbody></table></div>
    <style>{`@media print { aside, header, .partner-inventory-page button, .partner-inventory-page select, .partner-inventory-page input, .partner-inventory-page a { display: none !important; } .partner-inventory-page { margin: 0 !important; padding: 0 !important; } }`}</style>
  </div>;
}

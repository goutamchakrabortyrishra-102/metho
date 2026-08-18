import React, { useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Printer, Search } from "lucide-react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { buildReportPdf, buildReportWorkbook, moneyIndexes, REPORTS, rowValues } from "@/lib/partnerReports";

const inr = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function PartnerReportsPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [kind, setKind] = useState("products");
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (user?.role !== "partner") return;
    api.get("/partner/reports").then((response) => setData(response.data || {})).catch((error) => toast.error(error?.response?.data?.detail || "Reports could not be loaded"));
  }, [user]);
  const rows = useMemo(() => {
    const source = Array.isArray(data?.[kind]) ? data[kind] : [];
    const term = search.trim().toLowerCase();
    return term ? source.filter((item) => JSON.stringify(item).toLowerCase().includes(term)) : source;
  }, [data, kind, search]);
  if (!user) return <div className="p-8 text-center">Loading...</div>;
  if (user.role !== "partner") return <Navigate to="/app" replace />;
  const report = REPORTS[kind];
  const exportExcel = () => {
    const workbook = buildReportWorkbook(kind, rows, data?.generated_at || new Date().toISOString());
    XLSX.writeFile(workbook, `Partner_${kind}_Report.xlsx`);
  };
  const exportPdf = async () => {
    const doc = buildReportPdf(kind, rows, data?.generated_at || new Date().toLocaleString("en-IN"));
    doc.save(`Partner_${kind}_Report.pdf`);
  };
  return <div className="partner-reports-page space-y-5" data-testid="partner-reports-page">
    <div className="partner-reports-toolbar flex flex-wrap items-end justify-between gap-3 print:hidden"><div><p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Partner Reports</p><h1 className="font-display font-black text-3xl text-emerald-950">{report.title}</h1><p className="text-sm text-slate-600">Filtered rows: {rows.length} · Generated: {data?.generated_at || "-"}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" className="rounded-full" onClick={exportPdf}><FileDown className="w-4 h-4 mr-2" /> PDF</Button><Button variant="outline" className="rounded-full" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 mr-2" /> Excel</Button><Button variant="outline" className="rounded-full" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" /> Print</Button></div></div>
    <div className="partner-reports-filters flex flex-wrap gap-2 print:hidden"><div className="relative flex-1 min-w-[220px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search current report" className="pl-9" /></div>{Object.entries(REPORTS).map(([key, value]) => <button key={key} type="button" onClick={() => { setKind(key); setSearch(""); }} className={`px-3 py-2 rounded-full border text-xs font-semibold ${kind === key ? "bg-emerald-900 text-white border-emerald-900" : "bg-white text-emerald-900 border-emerald-200"}`}>{value.title.replace(" Report", "")}</button>)}</div>
    <div className="partner-reports-print-header hidden"><h1>METHO AAY-UPAY</h1><h2>{report.title}</h2><p>Generated: {data?.generated_at || new Date().toLocaleString("en-IN")}</p></div>
    <div className="overflow-x-auto rounded-xl border border-border bg-white"><table className="min-w-full text-xs"><thead className="bg-emerald-900 text-white"><tr>{report.columns.map((column) => <th key={column} className="px-3 py-3 text-left whitespace-nowrap">{column}</th>)}</tr></thead><tbody className="divide-y divide-border">{rows.map((item, index) => <tr key={`${kind}-${index}`} className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>{rowValues(kind, item).map((value, valueIndex) => <td key={`${kind}-${index}-${valueIndex}`} className="px-3 py-2 whitespace-nowrap">{moneyIndexes(kind).includes(valueIndex) ? inr(value) : String(value ?? "-")}</td>)}</tr>)}{rows.length === 0 ? <tr><td colSpan={report.columns.length} className="px-4 py-10 text-center text-slate-500">No report rows found.</td></tr> : null}</tbody></table></div>
    <style>{`@media print { aside, header, .partner-reports-toolbar, .partner-reports-filters { display: none !important; } .partner-reports-page { margin: 0 !important; padding: 0 !important; } .partner-reports-print-header { display: block !important; margin-bottom: 12px; } .partner-reports-page table { font-size: 8px !important; width: 100% !important; } .partner-reports-page th, .partner-reports-page td { padding: 4px !important; } }`}</style>
  </div>;
}

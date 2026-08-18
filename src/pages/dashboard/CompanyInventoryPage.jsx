import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, FileDown, FileSpreadsheet, Printer, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

const inr = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const numberValue = (value) => Number(value || 0);
const reportDate = () => new Date().toLocaleString("en-IN");
const tableHeaders = ["Product Name", "Product Code", "Purchase Cost", "Price Before GST", "GST %", "GST Amount", "Final Price", "Company Stock", "Purchase Value", "Selling Value", "Potential Margin", "Stock Status"];

const buildReportRows = (items) => items.map((item) => ([
  item.name || "",
  item.sku || "-",
  numberValue(item.purchase_cost),
  numberValue(item.price_before_gst),
  numberValue(item.gst_percent),
  numberValue(item.gst_amount),
  numberValue(item.final_price),
  numberValue(item.company_stock),
  numberValue(item.purchase_value),
  numberValue(item.selling_value),
  numberValue(item.potential_margin),
  String(item.stock_status || "").replaceAll("_", " "),
]));

export default function CompanyInventoryPage() {
  const { user } = useAuth();
  const isAdmin = user && ["super_admin", "company_admin", "admin"].includes(user.role);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

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

  const items = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data?.items]);
  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !term || [item.name, item.sku, item.stock_status].some((value) => String(value || "").toLowerCase().includes(term));
      const matchesStatus = statusFilter === "all" || String(item.stock_status || "") === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [items, search, statusFilter]);
  const filteredSummary = useMemo(() => ({
    totalProducts: filteredItems.length,
    totalStock: filteredItems.reduce((sum, item) => sum + numberValue(item.company_stock), 0),
    purchaseValue: filteredItems.reduce((sum, item) => sum + numberValue(item.purchase_value), 0),
    sellingValue: filteredItems.reduce((sum, item) => sum + numberValue(item.selling_value), 0),
    potentialMargin: filteredItems.reduce((sum, item) => sum + numberValue(item.potential_margin), 0),
  }), [filteredItems]);

  if (!isAdmin) return <Navigate to="/app" replace />;

  const exportPdf = async () => {
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 28;
      const rows = buildReportRows(filteredItems);
      const sections = [
        {
          title: "SECTION 1 - PRICING & GST",
          indexes: [0, 1, 2, 3, 4, 5, 6],
          widths: [154, 82, 82, 102, 52, 86, 94],
        },
        {
          title: "SECTION 2 - STOCK & VALUE",
          indexes: [0, 1, 7, 8, 9, 10, 11],
          widths: [154, 82, 82, 102, 102, 102, 94],
        },
      ];
      const formatCell = (value, sourceIndex) => sourceIndex >= 2 && sourceIndex <= 10 ? inr(value) : String(value);
      const drawSection = (section, y) => {
        const headers = section.indexes.map((index) => tableHeaders[index]);
        const sectionRows = rows.map((row) => section.indexes.map((index) => row[index]));
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(5, 78, 59);
        doc.text(section.title, margin, y);
        y += 18;
        const headerLines = headers.map((header, index) => doc.splitTextToSize(header, section.widths[index] - 8));
        const headerHeight = Math.max(...headerLines.map((lines) => lines.length * 9)) + 12;
        doc.setFillColor(5, 78, 59);
        doc.rect(margin, y - 10, section.widths.reduce((sum, width) => sum + width, 0), headerHeight, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);
        let x = margin + 3;
        headerLines.forEach((lines, index) => {
          doc.text(lines, x, y + 2);
          x += section.widths[index];
        });
        y += headerHeight;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        sectionRows.forEach((row, rowIndex) => {
          const cellLines = row.map((value, index) => doc.splitTextToSize(formatCell(value, section.indexes[index]), section.widths[index] - 8));
          const rowHeight = Math.max(18, ...cellLines.map((lines) => lines.length * 9 + 8));
          if (y + rowHeight > pageHeight - 34) {
            doc.addPage();
            y = 38;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.setTextColor(5, 78, 59);
            doc.text(section.title, margin, y);
            y += 18;
            const repeatedHeaderLines = headers.map((header, index) => doc.splitTextToSize(header, section.widths[index] - 8));
            const repeatedHeaderHeight = Math.max(...repeatedHeaderLines.map((lines) => lines.length * 9)) + 12;
            doc.setFillColor(5, 78, 59);
            doc.rect(margin, y - 10, section.widths.reduce((sum, width) => sum + width, 0), repeatedHeaderHeight, "F");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8);
            doc.setTextColor(255, 255, 255);
            let repeatedX = margin + 4;
            repeatedHeaderLines.forEach((lines, index) => {
              doc.text(lines, repeatedX, y + 2);
              repeatedX += section.widths[index];
            });
            y += repeatedHeaderHeight;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
          }
          if (rowIndex % 2 === 0) {
            doc.setFillColor(241, 245, 249);
            doc.rect(margin, y - 10, section.widths.reduce((sum, width) => sum + width, 0), rowHeight, "F");
          }
          doc.setTextColor(30, 41, 59);
          let cellX = margin + 4;
          cellLines.forEach((lines, index) => {
            doc.text(lines, cellX, y + 2);
            cellX += section.widths[index];
          });
          y += rowHeight;
        });
        return y + 24;
      };

      doc.setTextColor(5, 46, 41);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("METHO AAY-UPAY", margin, 34);
      doc.setFontSize(12);
      doc.text("MAIN COMPANY INVENTORY REPORT", margin, 51);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(`Generated: ${reportDate()}`, margin, 66);
      doc.text(`Admin: ${user?.name || user?.email || "Company Admin"}`, margin, 78);
      doc.text(`Search: ${search || "All"}   Status: ${statusFilter === "all" ? "All" : statusFilter.replaceAll("_", " ")}`, margin, 90);

      let y = 112;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(5, 46, 41);
      doc.text(`Products: ${filteredSummary.totalProducts}`, margin, y);
      doc.text(`Total Stock: ${filteredSummary.totalStock}`, margin + 115, y);
      doc.text(`Purchase Value: ${inr(filteredSummary.purchaseValue)}`, margin + 230, y);
      doc.text(`Selling Value: ${inr(filteredSummary.sellingValue)}`, margin + 360, y);
      doc.text(`Potential Margin: ${inr(filteredSummary.potentialMargin)}`, margin + 490, y);
      y = drawSection(sections[0], y + 24);
      drawSection(sections[1], y);
      const totalPages = doc.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(`Page ${page} of ${totalPages}`, pageWidth - margin, pageHeight - 16, { align: "right" });
      }
      doc.save("METHO_Company_Inventory_Report.pdf");
    } catch {
      toast.error("Unable to generate PDF. Please try again.");
    }
  };

  const exportExcel = async () => {
    try {
      const XLSX = await import("xlsx");
      const rows = buildReportRows(filteredItems);
      const summaryRows = [
        ["METHO AAY-UPAY - MAIN COMPANY INVENTORY REPORT"],
        [`Generated: ${reportDate()}`],
        [],
        ["Total Products", filteredSummary.totalProducts],
        ["Total Stock", filteredSummary.totalStock],
        ["Total Purchase Value", filteredSummary.purchaseValue],
        ["Total Selling Value", filteredSummary.sellingValue],
        ["Total Potential Margin", filteredSummary.potentialMargin],
        [],
        tableHeaders,
        ...rows,
      ];
      const sheet = XLSX.utils.aoa_to_sheet(summaryRows);
      sheet["!cols"] = [
        { wch: 26 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 10 }, { wch: 14 },
        { wch: 13 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 16 },
      ];
      sheet["!autofilter"] = { ref: `A10:L${Math.max(10, summaryRows.length)}` };
      sheet["!freeze"] = { xSplit: 0, ySplit: 9 };
      const headerRange = XLSX.utils.decode_range("A10:L10");
      for (let column = headerRange.s.c; column <= headerRange.e.c; column += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: 9, c: column })];
        if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: "064E3B" } }, color: "FFFFFF" };
      }
      const filename = `METHO_Company_Inventory_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Company Inventory");
      XLSX.writeFile(workbook, filename);
    } catch {
      toast.error("Unable to generate Excel file. Please try again.");
    }
  };

  const printReport = () => window.print();

  return (
    <div className="company-inventory-page space-y-6" data-testid="company-inventory-page">
      <style>{companyInventoryPrintStyles}</style>
      <div className="company-inventory-toolbar flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Company Inventory</h1>
          <p className="text-sm text-muted-foreground mt-1">Main company stock only. METHO Store inventory is managed separately.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="rounded-full" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
          <Button type="button" variant="outline" className="rounded-full" onClick={exportPdf}><FileDown className="w-4 h-4 mr-2" /> Export PDF</Button>
          <Button type="button" variant="outline" className="rounded-full" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 mr-2" /> Export Excel</Button>
          <Button type="button" variant="outline" className="rounded-full" onClick={printReport}><Printer className="w-4 h-4 mr-2" /> Print</Button>
        </div>
      </div>

      <div className="company-inventory-filters flex flex-wrap gap-3">
        <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, SKU or status" className="pl-9" /></div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-input bg-white px-3 text-sm"><option value="all">All stock statuses</option><option value="in_stock">In stock</option><option value="low_stock">Low stock</option><option value="out_of_stock">Out of stock</option></select>
      </div>

      <div className="company-inventory-print-header hidden"><h1>METHO AAY-UPAY</h1><h2>MAIN COMPANY INVENTORY REPORT</h2><p>Generated: {reportDate()}</p><p>Admin: {user?.name || user?.email || "Company Admin"}</p></div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Summary label="Total Products" value={filteredSummary.totalProducts} />
        <Summary label="Company Units" value={filteredSummary.totalStock} />
        <Summary label="Purchase Value" value={inr(filteredSummary.purchaseValue)} />
        <Summary label="Selling Value" value={inr(filteredSummary.sellingValue)} />
        <Summary label="Potential Margin" value={inr(filteredSummary.potentialMargin)} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="bg-emerald-900 text-white">
            <tr>
              {tableHeaders.map((label) => <th key={label} className="px-3 py-3 text-left text-xs uppercase tracking-wider">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredItems.map((item) => (
              <tr key={item.product_id}>
                <td className="px-3 py-3 font-semibold text-emerald-950">{item.name}</td>
                <td className="px-3 py-3 font-mono text-xs text-slate-600">{item.sku || "-"}</td>
                <td className="px-3 py-3">{inr(item.purchase_cost)}</td>
                <td className="px-3 py-3">{inr(item.price_before_gst)}</td>
                <td className="px-3 py-3">{numberValue(item.gst_percent)}%</td>
                <td className="px-3 py-3">{inr(item.gst_amount)}</td>
                <td className="px-3 py-3 font-bold text-emerald-800">{inr(item.final_price)}</td>
                <td className="px-3 py-3 font-bold">{item.company_stock}</td>
                <td className="px-3 py-3">{inr(item.purchase_value)}</td>
                <td className="px-3 py-3">{inr(item.selling_value)}</td>
                <td className="px-3 py-3">{inr(item.potential_margin)}</td>
                <td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${item.stock_status === "out_of_stock" ? "bg-red-100 text-red-700" : item.stock_status === "low_stock" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{item.stock_status === "low_stock" || item.stock_status === "out_of_stock" ? <AlertTriangle className="w-3 h-3" /> : <Boxes className="w-3 h-3" />} {item.stock_status.replaceAll("_", " ")}</span></td>
              </tr>
            ))}
            {!loading && filteredItems.length === 0 ? <tr><td colSpan="12" className="px-4 py-10 text-center text-slate-500">No company products found.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const companyInventoryPrintStyles = `
  @media print {
    aside, header, .company-inventory-toolbar, .company-inventory-filters, .company-inventory-page > p { display: none !important; }
    .company-inventory-page { padding: 0 !important; margin: 0 !important; }
    .company-inventory-print-header { display: block !important; margin-bottom: 16px; }
    .company-inventory-page .grid { display: grid !important; }
    .company-inventory-page .overflow-x-auto { overflow: visible !important; border: 0 !important; }
    .company-inventory-page table { min-width: 0 !important; width: 100% !important; font-size: 8px !important; }
    .company-inventory-page th, .company-inventory-page td { padding: 4px !important; }
  }
`;

function Summary({ label, value, tone = "emerald" }) {
  const colors = tone === "red" ? "border-red-200 text-red-700" : tone === "amber" ? "border-amber-200 text-amber-700" : "border-border text-emerald-950";
  return <div className={`rounded-xl border bg-white p-4 ${colors}`}><p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</p><p className="font-display font-black text-xl mt-1">{value}</p></div>;
}

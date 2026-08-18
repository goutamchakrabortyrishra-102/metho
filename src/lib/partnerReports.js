import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";

export const REPORTS = {
  products: { title: "Product Inventory Report", columns: ["Product", "SKU", "Category", "Purchase Cost", "Price Before GST", "GST %", "GST Amount", "Final Price", "Opening Stock", "Current Stock", "Sold", "Available", "Stock Status", "Revenue"] },
  services: { title: "Service Availability Report", columns: ["Service", "Sector", "Category", "Rate", "GST %", "GST Amount", "Final Rate", "Service Area", "Availability", "Revenue"] },
  transport: { title: "Transport Fleet Report", columns: ["Vehicle", "Vehicle Number", "Vehicle Type", "Capacity", "Base Fare", "Per KM", "GST %", "GST Amount", "Final Fare", "Bookings", "Active Trips", "Completed Trips", "Cancelled Trips", "Availability", "Revenue"] },
  courier: { title: "Courier Delivery Report", columns: ["Booking ID", "Courier Service", "Pickup", "Delivery", "Delivery Charge", "GST %", "GST Amount", "Final Amount", "Payment Status", "Delivery Status", "Revenue"] },
  property: { title: "Property Listing Report", columns: ["Property", "Property Type", "Listing Type", "Area", "Area Unit", "Location", "District", "City", "Price", "Status", "Enquiries"] },
};

export const rowValues = (kind, item) => {
  if (kind === "products") return [item.product, item.sku, item.category, item.purchase_cost, item.price_before_gst, item.gst_percent, item.gst_amount, item.final_price, item.opening_stock, item.current_stock, item.sold, item.available, item.stock_status, item.revenue];
  if (kind === "services") return [item.service, item.sector, item.category, item.rate, item.gst_percent, item.gst_amount, item.final_rate, item.service_area, item.availability, item.revenue];
  if (kind === "transport") return [item.vehicle, item.vehicle_number, item.vehicle_type, item.capacity, item.base_fare, item.per_km_rate, item.gst_percent, item.gst_amount, item.final_fare, item.bookings, item.active_trips, item.completed_trips, item.cancelled_trips, item.availability, item.revenue];
  if (kind === "courier") return [item.booking_id, item.courier_service, item.pickup, item.delivery, item.delivery_charge, item.gst_percent, item.gst_amount, item.final_amount, item.payment_status, item.delivery_status, item.revenue];
  return [item.property, item.property_type, item.listing_type, item.area, item.area_unit, item.location, item.district, item.city, item.price, item.status, item.enquiries];
};

export const moneyIndexes = (kind) => kind === "products" ? [3, 4, 6, 7, 13] : kind === "services" ? [3, 5, 6, 9] : kind === "transport" ? [4, 5, 7, 8, 14] : kind === "courier" ? [4, 6, 7, 10] : [8];
const inr = (value) => `INR ${Number(value || 0).toFixed(2)}`;

export const buildReportWorkbook = (kind, rows, generatedAt = new Date().toISOString()) => {
  const report = REPORTS[kind];
  const sheet = XLSX.utils.aoa_to_sheet([["METHO AAY-UPAY", report.title], ["Generated", generatedAt], [], report.columns, ...rows.map((item) => rowValues(kind, item))]);
  sheet["!cols"] = report.columns.map(() => ({ wch: 18 }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, kind);
  return workbook;
};

export const buildReportPdf = (kind, rows, generatedAt = new Date().toLocaleString("en-IN")) => {
  const report = REPORTS[kind];
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 24;
  const widths = report.columns.map(() => Math.max(42, (pageWidth - margin * 2) / report.columns.length));
  const drawHeader = () => {
    doc.setFillColor(5, 78, 59); doc.rect(0, 0, pageWidth, 58, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text("METHO AAY-UPAY", margin, 23);
    doc.setFontSize(11); doc.text(report.title, margin, 42); doc.setFontSize(8); doc.text(`Generated: ${generatedAt}`, pageWidth - margin, 23, { align: "right" });
  };
  const drawTableHeader = (y) => {
    doc.setFillColor(226, 232, 240); doc.rect(margin, y - 12, widths.reduce((sum, width) => sum + width, 0), 24, "F");
    doc.setTextColor(15, 23, 42); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
    let x = margin + 3; report.columns.forEach((column, index) => { doc.text(doc.splitTextToSize(column, widths[index] - 6), x, y); x += widths[index]; });
    return y + 20;
  };
  drawHeader(); let y = drawTableHeader(82); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
  const money = new Set(moneyIndexes(kind));
  rows.forEach((item, rowIndex) => {
    const values = rowValues(kind, item).map((value, index) => money.has(index) ? inr(value) : String(value ?? "-"));
    const lines = values.map((value, index) => doc.splitTextToSize(value, widths[index] - 6));
    const rowHeight = Math.max(18, ...lines.map((line) => line.length * 8 + 6));
    if (y + rowHeight > pageHeight - 28) { doc.addPage(); drawHeader(); y = drawTableHeader(82); }
    if (rowIndex % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 10, widths.reduce((sum, width) => sum + width, 0), rowHeight, "F"); }
    let x = margin + 3; doc.setTextColor(30, 41, 59); lines.forEach((line, index) => { doc.text(line, x, y); x += widths[index]; }); y += rowHeight;
  });
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) { doc.setPage(page); doc.setFontSize(8); doc.setTextColor(100, 116, 139); doc.text(`Page ${page} of ${totalPages}`, pageWidth - margin, pageHeight - 12, { align: "right" }); }
  return doc;
};

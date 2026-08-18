import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { buildReportPdf, buildReportWorkbook, REPORTS, rowValues } from "./partnerReports";

const sampleRows = {
  products: [{ product: "Partner Product", sku: "SKU-1", category: "General", purchase_cost: 50, price_before_gst: 100, gst_percent: 5, gst_amount: 5, final_price: 105, opening_stock: 10, current_stock: 9, sold: 1, available: 9, stock_status: "Available", revenue: 105 }],
  services: [{ service: "AC Service", sector: "Doorstep", category: "Repair", rate: 500, gst_percent: 5, gst_amount: 25, final_rate: 525, service_area: "Rishra", availability: "available", revenue: 525 }],
  transport: [{ vehicle: "Cab", vehicle_number: "WB01A1234", vehicle_type: "sedan", capacity: 4, base_fare: 300, per_km_rate: 18, gst_percent: 5, gst_amount: 15, final_fare: 315, bookings: 1, active_trips: 0, completed_trips: 1, cancelled_trips: 0, availability: "available", revenue: 315 }],
  courier: [{ booking_id: "DEL-1", courier_service: "Parcel Delivery", pickup: "Rishra", delivery: "Kolkata", delivery_charge: 120, gst_percent: 5, gst_amount: 6, final_amount: 126, payment_status: "paid", delivery_status: "delivered", revenue: 126 }],
  property: [{ property: "Rishra Plot", property_type: "Plot", listing_type: "For Sale", area: 3, area_unit: "Katha", location: "Rishra", district: "Hooghly", city: "Rishra", price: 2500000, status: "AVAILABLE", enquiries: 1 }],
};

describe("partner report artifacts", () => {
  test.each(Object.keys(REPORTS))("generates a readable %s PDF and XLSX", (kind) => {
    const rows = sampleRows[kind];
    const pdfBytes = new Uint8Array(buildReportPdf(kind, rows, "2026-08-18").output("arraybuffer"));
    expect(pdfBytes.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder("latin1").decode(pdfBytes.slice(0, 5))).toBe("%PDF-");

    const workbook = buildReportWorkbook(kind, rows, "2026-08-18");
    const xlsxBytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    expect(xlsxBytes.byteLength).toBeGreaterThan(0);
    const parsed = XLSX.read(xlsxBytes, { type: "array" });
    expect(parsed.SheetNames).toContain(kind);
    const values = XLSX.utils.sheet_to_json(parsed.Sheets[kind], { header: 1, raw: true });
    expect(values[3]).toEqual(REPORTS[kind].columns);
    expect(values[4]).toEqual(rowValues(kind, rows[0]));
    expect(typeof values[4].find((value) => typeof value === "number")).toBe("number");
    expect(JSON.stringify(values).toLowerCase()).not.toMatch(/wallet|commission|internal_margin|api_key|password|token/);
  });

  test("print surface keeps sector title, headers, rows and hides controls", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../pages/dashboard/PartnerReportsPage.jsx"), "utf8");
    expect(source).toContain("data-testid=\"partner-reports-page\"");
    expect(source).toContain("report.title");
    expect(source).toContain("report.columns.map");
    expect(source).toContain("rows.map");
    expect(source).toContain("@media print");
    expect(source).toContain(".partner-reports-toolbar");
    expect(source).toContain(".partner-reports-filters");
    expect(source).toContain("aside, header");
  });
});

import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Printer, ArrowLeft, FileText } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PartnerPayoutStatementPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [ledger, setLedger] = useState([]);

  useEffect(() => {
    if (user?.role !== "partner") return;
    api.get("/partner/summary").then(r => setSummary(r.data));
    api.get("/partner/ledger").then(r => setLedger(r.data));
  }, [user]);

  if (!user) return <div className="p-8 text-center">Loading...</div>;
  if (user.role !== "partner") return <Navigate to="/app" replace />;
  if (!summary) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0" data-testid="partner-payout-page">
      <div className="max-w-4xl mx-auto px-4 flex items-center justify-between mb-4 print:hidden">
        <Link to="/partner" className="inline-flex items-center gap-2 text-emerald-900 hover:underline font-semibold text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Link>
        <Button onClick={() => window.print()} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="print-payout-button">
          <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
        </Button>
      </div>

      <div className="max-w-4xl mx-auto bg-white shadow-lg print:shadow-none border border-slate-200 print:border-0" id="payout-print">
        <div className="border-b-4 border-emerald-900 px-8 py-6 bg-gradient-to-br from-emerald-50/40 to-white flex justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-amber-600 font-bold">Partner Payout Statement</p>
            <h1 className="font-display font-black text-3xl text-emerald-950 mt-1">{summary.business_name}</h1>
            <p className="text-xs text-slate-600 font-body mt-1">Partner Code: <span className="font-mono font-semibold">{summary.partner_code}</span> · Commission Rate: <b>{summary.commission_percent}%</b></p>
          </div>
          <div className="text-right">
            <div className="inline-flex items-center gap-1 text-emerald-900 font-bold text-lg font-display"><FileText className="w-5 h-5" /> STATEMENT</div>
            <p className="mt-2 text-xs text-slate-500 uppercase tracking-wider font-semibold">Generated</p>
            <p className="text-sm font-semibold text-emerald-950">{new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
          </div>
        </div>

        <div className="px-8 py-5 grid grid-cols-3 gap-4 border-b border-slate-200 bg-slate-50/40">
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">Total Sales</p><p className="font-display font-black text-xl text-emerald-950">{inr(summary.total_sales)}</p></div>
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">Commission Earned</p><p className="font-display font-black text-xl text-emerald-800">{inr(summary.total_commission_paid)}</p></div>
          <div><p className="text-[10px] uppercase text-slate-500 font-bold">This Month ({summary.current_period})</p><p className="font-display font-black text-xl text-amber-700">{inr(summary.this_month.commission)}</p><p className="text-[10px] text-slate-500">{summary.this_month.orders} orders</p></div>
        </div>

        <div className="px-8 py-5">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Ledger Entries</p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-emerald-900 text-white">
                <th className="text-left px-3 py-2 text-xs uppercase tracking-wider">Date</th>
                <th className="text-left px-3 py-2 text-xs uppercase tracking-wider">Period</th>
                <th className="text-right px-3 py-2 text-xs uppercase tracking-wider">Sales</th>
                <th className="text-right px-3 py-2 text-xs uppercase tracking-wider">Rate</th>
                <th className="text-right px-3 py-2 text-xs uppercase tracking-wider">Commission</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e, i) => (
                <tr key={i} className={i % 2 ? "bg-slate-50" : ""}>
                  <td className="px-3 py-2 text-xs">{new Date(e.created_at).toLocaleDateString("en-IN")}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.period}</td>
                  <td className="text-right px-3 py-2">{inr(e.sales_amount)}</td>
                  <td className="text-right px-3 py-2">{e.commission_percent}%</td>
                  <td className="text-right px-3 py-2 font-semibold text-emerald-800">{inr(e.commission_amount)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-emerald-900 font-bold">
                <td colSpan="2" className="px-3 py-2 text-right">TOTAL</td>
                <td className="text-right px-3 py-2">{inr(ledger.reduce((s, e) => s + (e.sales_amount || 0), 0))}</td>
                <td></td>
                <td className="text-right px-3 py-2 text-emerald-800">{inr(ledger.reduce((s, e) => s + (e.commission_amount || 0), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="px-8 py-4 border-t border-slate-200 text-[10px] text-slate-500 italic bg-slate-50/70">
          System-generated statement. For any discrepancy, contact billing@metho.com within 30 days.
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          #payout-print { box-shadow: none !important; border: none !important; }
        }
      `}</style>
    </div>
  );
}


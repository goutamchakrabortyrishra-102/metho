import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import { Calculator, RefreshCw, TrendingUp, TrendingDown, Landmark, BadgeIndianRupee, FileClock, PlusCircle } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const inr = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const percent = (value) => `${Number(value || 0).toFixed(1)}%`;
const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const EMPTY_AUTO = { income_items: [], expense_items: [] };
const EMPTY_MANUAL = [];

const parseDate = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const COST_CATEGORIES = [
  "Staff Salary",
  "Transport Cost",
  "Partner Onboarding Commission",
  "Damage Cost",
  "Advertisement Cost",
  "Office Rent",
  "Utility Bill",
  "Packaging / Delivery",
  "Legal / Compliance",
  "Technology / Software",
  "Miscellaneous",
];

const SummaryCard = ({ icon: Icon, label, value, tone = "emerald", hint }) => (
  <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold">{label}</p>
        <p className="font-display font-black text-2xl text-emerald-950 mt-1">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
      </div>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tone === "amber" ? "bg-amber-100" : tone === "red" ? "bg-red-100" : "bg-emerald-100"}`}>
        <Icon className={`w-5 h-5 ${tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-emerald-800"}`} />
      </div>
    </div>
  </div>
);

export default function AccountsPage() {
  const { user } = useAuth();
  const isAdmin = user && ["super_admin", "company_admin", "admin"].includes(user.role);
  const today = new Date().toISOString().slice(0, 10);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [direction, setDirection] = useState("expense");
  const [category, setCategory] = useState(COST_CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(today);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [period, setPeriod] = useState("this_month");

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const { data: payload } = await api.get("/admin/accounts");
      setData(payload);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const summary = data?.summary || {};
  const auto = useMemo(() => data?.auto || EMPTY_AUTO, [data]);
  const manualEntries = useMemo(() => data?.manual_entries || EMPTY_MANUAL, [data]);

  const allTransactions = useMemo(() => {
    const incomeRows = (auto.income_items || []).map((item) => ({
      id: `auto-income-${item.id || item.created_at || Math.random()}`,
      type: "auto",
      direction: "income",
      amount: Number(item.amount || 0),
      category: item.category || "Income",
      label: item.label || "Auto income",
      source: item.source || "system",
      timestamp: parseDate(item.created_at),
    }));

    const expenseRows = (auto.expense_items || []).map((item) => ({
      id: `auto-expense-${item.id || item.created_at || Math.random()}`,
      type: "auto",
      direction: "expense",
      amount: Math.abs(Number(item.amount || 0)),
      category: item.category || "Expense",
      label: item.label || "Auto expense",
      source: item.source || "system",
      timestamp: parseDate(item.created_at),
    }));

    const manualRows = manualEntries.map((entry) => ({
      id: `manual-${entry.id || entry.created_at || Math.random()}`,
      type: "manual",
      direction: String(entry.direction || "expense").toLowerCase() === "income" ? "income" : "expense",
      amount: Math.abs(Number(entry.amount || 0)),
      category: entry.category || "Miscellaneous",
      label: entry.description || entry.category || "Manual entry",
      source: "manual",
      timestamp: parseDate(entry.date || entry.created_at),
    }));

    return [...incomeRows, ...expenseRows, ...manualRows];
  }, [auto.expense_items, auto.income_items, manualEntries]);

  const periodLabel = useMemo(() => {
    if (period === "this_month") return "This Month";
    if (period === "last_30_days") return "Last 30 Days";
    return "All Time";
  }, [period]);

  const filteredTransactions = useMemo(() => {
    if (period === "all_time") return allTransactions;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const periodStart = period === "this_month"
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : new Date(startOfToday.getTime() - (29 * 24 * 60 * 60 * 1000));
    return allTransactions.filter((tx) => {
      if (!tx.timestamp) return false;
      return tx.timestamp >= periodStart && tx.timestamp <= now;
    });
  }, [allTransactions, period]);

  const periodSummary = useMemo(() => {
    const totals = {
      income_total: 0,
      expense_total: 0,
      net_balance: 0,
      auto_income_total: 0,
      auto_expense_total: 0,
      manual_income_total: 0,
      manual_expense_total: 0,
    };
    filteredTransactions.forEach((tx) => {
      if (tx.direction === "income") {
        totals.income_total += tx.amount;
        if (tx.type === "auto") totals.auto_income_total += tx.amount;
        else totals.manual_income_total += tx.amount;
      } else {
        totals.expense_total += tx.amount;
        if (tx.type === "auto") totals.auto_expense_total += tx.amount;
        else totals.manual_expense_total += tx.amount;
      }
    });
    totals.net_balance = totals.income_total - totals.expense_total;
    Object.keys(totals).forEach((k) => {
      totals[k] = round2(totals[k]);
    });
    return totals;
  }, [filteredTransactions]);

  const categoryRows = useMemo(() => {
    const bucket = {};
    filteredTransactions.forEach((tx) => {
      const key = String(tx.category || "Miscellaneous").trim() || "Miscellaneous";
      if (!bucket[key]) {
        bucket[key] = { income: 0, expense: 0 };
      }
      if (tx.direction === "income") bucket[key].income += tx.amount;
      else bucket[key].expense += tx.amount;
    });
    return Object.entries(bucket)
      .map(([name, totals]) => ({
        name,
        income: round2(totals.income),
        expense: round2(totals.expense),
        net: round2(totals.income - totals.expense),
      }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [filteredTransactions]);

  const autoIncomeFiltered = useMemo(() => filteredTransactions
    .filter((tx) => tx.type === "auto" && tx.direction === "income")
    .map((tx) => ({ id: tx.id, label: tx.label, category: tx.category, source: tx.source, amount: tx.amount })), [filteredTransactions]);

  const autoExpenseFiltered = useMemo(() => filteredTransactions
    .filter((tx) => tx.type === "auto" && tx.direction === "expense")
    .map((tx) => ({ id: tx.id, label: tx.label, category: tx.category, source: tx.source, amount: tx.amount })), [filteredTransactions]);

  const manualEntriesFiltered = useMemo(() => {
    if (period === "all_time") return manualEntries;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const periodStart = period === "this_month"
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : new Date(startOfToday.getTime() - (29 * 24 * 60 * 60 * 1000));
    return manualEntries.filter((entry) => {
      const dt = parseDate(entry.date || entry.created_at);
      if (!dt) return false;
      return dt >= periodStart && dt <= now;
    });
  }, [manualEntries, period]);

  const netMarginPct = useMemo(() => {
    if (!periodSummary.income_total) return 0;
    return (periodSummary.net_balance / periodSummary.income_total) * 100;
  }, [periodSummary.income_total, periodSummary.net_balance]);

  const expenseRatioPct = useMemo(() => {
    if (!periodSummary.income_total) return 0;
    return (periodSummary.expense_total / periodSummary.income_total) * 100;
  }, [periodSummary.expense_total, periodSummary.income_total]);

  const manualSharePct = useMemo(() => {
    const total = periodSummary.income_total + periodSummary.expense_total;
    if (!total) return 0;
    return ((periodSummary.manual_income_total + periodSummary.manual_expense_total) / total) * 100;
  }, [periodSummary.expense_total, periodSummary.income_total, periodSummary.manual_expense_total, periodSummary.manual_income_total]);

  const exportExcel = () => {
    if (!data) {
      toast.error("No accounts data to export");
      return;
    }

    const wb = XLSX.utils.book_new();
    const summaryRows = [
      ["METHO AAY-UPAY Accounts", ""],
      ["Generated At", new Date().toLocaleString()],
      ["Period", periodLabel],
      ["Income Total", periodSummary.income_total || 0],
      ["Expense Total", periodSummary.expense_total || 0],
      ["Net Balance", periodSummary.net_balance || 0],
      ["Auto Income", periodSummary.auto_income_total || 0],
      ["Auto Expense", periodSummary.auto_expense_total || 0],
      ["Manual Income", periodSummary.manual_income_total || 0],
      ["Manual Expense", periodSummary.manual_expense_total || 0],
      ["Expense Ratio", percent(expenseRatioPct)],
      ["Net Margin", percent(netMarginPct)],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 24 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

    const bucketRows = [["Category", "Income", "Expense", "Net"]];
    categoryRows.forEach((row) => bucketRows.push([row.name, row.income, row.expense, row.net]));
    const bucketSheet = XLSX.utils.aoa_to_sheet(bucketRows);
    bucketSheet["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, bucketSheet, "Buckets");

    const incomeRows = [["Label", "Category", "Source", "Amount", "Created At"]];
    autoIncomeFiltered.forEach((item) => incomeRows.push([item.label || "", item.category || "", item.source || "", item.amount || 0, item.created_at || ""]));
    const incomeSheet = XLSX.utils.aoa_to_sheet(incomeRows);
    incomeSheet["!cols"] = [{ wch: 30 }, { wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, incomeSheet, "Income");

    const expenseRows = [["Label", "Category", "Source", "Amount", "Created At"]];
    autoExpenseFiltered.forEach((item) => expenseRows.push([item.label || "", item.category || "", item.source || "", item.amount || 0, item.created_at || ""]));
    const expenseSheet = XLSX.utils.aoa_to_sheet(expenseRows);
    expenseSheet["!cols"] = [{ wch: 30 }, { wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, expenseSheet, "Expenses");

    const manualRows = [["Category", "Direction", "Amount", "Description", "Reference", "Date"]];
    manualEntriesFiltered.forEach((entry) => manualRows.push([entry.category || "", entry.direction || "", entry.amount || 0, entry.description || "", entry.reference || "", entry.date || ""]));
    const manualSheet = XLSX.utils.aoa_to_sheet(manualRows);
    manualSheet["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 20 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, manualSheet, "Manual Ledger");

    const filename = `METHO_Accounts_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast.success(`Exported ${filename}`);
  };

  const exportPdf = () => {
    if (!data) {
      toast.error("No accounts data to export");
      return;
    }

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    let cursorY = 48;

    const line = (text, options = {}) => {
      const size = options.size || 11;
      const color = options.color || [30, 41, 59];
      doc.setFont("helvetica", options.bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
      const lines = doc.splitTextToSize(String(text || ""), pageWidth - margin * 2);
      doc.text(lines, margin, cursorY);
      cursorY += lines.length * (size + 2);
      return cursorY;
    };

    const section = (title) => {
      cursorY += 8;
      line(title, { size: 13, bold: true, color: [6, 95, 70] });
      cursorY += 2;
    };

    line("METHO AAY-UPAY Accounts Report", { size: 18, bold: true, color: [6, 95, 70] });
    line(`Generated: ${new Date().toLocaleString()}`, { size: 10, color: [100, 116, 139] });
    cursorY += 6;

    section("Summary");
    line(`Period: ${periodLabel}`);
    line(`Income Total: ${inr(periodSummary.income_total)}`);
    line(`Expense Total: ${inr(periodSummary.expense_total)}`);
    line(`Net Balance: ${inr(periodSummary.net_balance)}`);
    line(`Auto Income: ${inr(periodSummary.auto_income_total)} | Manual Income: ${inr(periodSummary.manual_income_total)}`);
    line(`Auto Expense: ${inr(periodSummary.auto_expense_total)} | Manual Expense: ${inr(periodSummary.manual_expense_total)}`);
    line(`Expense Ratio: ${percent(expenseRatioPct)} | Net Margin: ${percent(netMarginPct)}`);

    section("Top Cost Buckets");
    categoryRows.slice(0, 8).forEach((row) => {
      line(`${row.name}: Income ${inr(row.income)} | Expense ${inr(row.expense)} | Net ${inr(row.net)}`, { size: 10 });
    });

    const topIncome = autoIncomeFiltered.slice(0, 8);
    if (topIncome.length) {
      section("Recent Auto Income");
      topIncome.forEach((item) => {
        line(`${item.label} (${item.category}): ${inr(item.amount)}`, { size: 10 });
      });
    }

    const topExpense = autoExpenseFiltered.slice(0, 8);
    if (topExpense.length) {
      section("Recent Auto Expenses");
      topExpense.forEach((item) => {
        line(`${item.label} (${item.category}): ${inr(item.amount)}`, { size: 10 });
      });
    }

    if (manualEntriesFiltered.length) {
      section("Manual Ledger");
      manualEntriesFiltered.slice(0, 10).forEach((entry) => {
        line(`${entry.category} | ${entry.direction} | ${inr(entry.amount)} | ${entry.description || ""}`, { size: 10 });
      });
    }

    const filename = `METHO_Accounts_${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);
    toast.success(`Exported ${filename}`);
  };

  if (!isAdmin) return <Navigate to="/app" replace />;

  const submitEntry = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/admin/accounts/entries", {
        category,
        direction,
        amount: Number(amount || 0),
        date: entryDate,
        description,
        reference,
      });
      toast.success("Account entry saved");
      setAmount("");
      setDescription("");
      setReference("");
      setCategory(COST_CATEGORIES[0]);
      setDirection("expense");
      setEntryDate(today);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="accounts-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin · Accounts</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Accounts Management</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">Auto-pulled income and expense summary with manual categorized cost tracking.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[170px]" data-testid="accounts-period-select">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="this_month">This Month</SelectItem>
              <SelectItem value="last_30_days">Last 30 Days</SelectItem>
              <SelectItem value="all_time">All Time</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportExcel} disabled={!data} className="rounded-full border-emerald-800 text-emerald-900 hover:bg-emerald-50" data-testid="accounts-export-excel-button">
            Excel
          </Button>
          <Button variant="outline" onClick={exportPdf} disabled={!data} className="rounded-full border-emerald-800 text-emerald-900 hover:bg-emerald-50" data-testid="accounts-export-pdf-button">
            PDF
          </Button>
          <Button variant="outline" onClick={load} disabled={loading} className="rounded-full border-emerald-800 text-emerald-900 hover:bg-emerald-50" data-testid="accounts-refresh-button">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={TrendingUp} label={`${periodLabel} Income`} value={inr(periodSummary.income_total)} hint={`Auto ${inr(periodSummary.auto_income_total)} + manual ${inr(periodSummary.manual_income_total)}`} tone="emerald" />
        <SummaryCard icon={TrendingDown} label={`${periodLabel} Expense`} value={inr(periodSummary.expense_total)} hint={`Auto ${inr(periodSummary.auto_expense_total)} + manual ${inr(periodSummary.manual_expense_total)}`} tone="red" />
        <SummaryCard icon={Landmark} label="Net Cashflow" value={inr(periodSummary.net_balance)} hint={`Net margin ${percent(netMarginPct)}`} tone="amber" />
        <SummaryCard icon={BadgeIndianRupee} label="Manual Share" value={percent(manualSharePct)} hint={`Expense ratio ${percent(expenseRatioPct)} · ${manualEntriesFiltered.length.toLocaleString("en-IN")} manual rows`} tone="emerald" />
      </div>

      <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-4">
        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-display font-bold text-emerald-950 text-xl">Cost Buckets</h2>
              <p className="text-xs text-muted-foreground mt-1">{periodLabel} categorized movement from both auto + manual rows.</p>
            </div>
            <div className="text-xs bg-emerald-50 text-emerald-800 px-2 py-1 rounded-full font-semibold">Auto + Manual</div>
          </div>
          <div className="space-y-3 max-h-[30rem] overflow-y-auto pr-1">
            {categoryRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No categorized costs yet.</p>
            ) : (
              categoryRows.map((row) => (
                <div key={row.name} className="rounded-lg border border-border p-4 bg-slate-50/60">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-emerald-950">{row.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">Income {inr(row.income)} · Expense {inr(row.expense)}</p>
                    </div>
                    <p className={`font-display font-black text-lg ${row.net >= 0 ? "text-emerald-700" : "text-red-700"}`}>{row.net >= 0 ? "+" : ""}{inr(row.net)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950 text-white rounded-xl p-5 relative overflow-hidden">
          <div className="absolute inset-0 grain opacity-20" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <PlusCircle className="w-6 h-6 text-amber-400" />
              <div>
                <h2 className="font-display font-bold text-xl">Add Manual Entry</h2>
                <p className="text-xs text-emerald-100/80 mt-1">Use this for staff salary, transport cost, ad spend, damage cost and other cash expenses.</p>
              </div>
            </div>

            <form className="mt-5 space-y-3" onSubmit={submitEntry}>
              <div>
                <Label className="text-emerald-50">Direction</Label>
                <Select value={direction} onValueChange={setDirection}>
                  <SelectTrigger className="bg-white text-slate-900 border-white/20" data-testid="accounts-direction-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-emerald-50">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="bg-white text-slate-900 border-white/20" data-testid="accounts-category-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COST_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-emerald-50">Amount (₹)</Label>
                <Input type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="bg-white text-slate-900" placeholder="0.00" data-testid="accounts-amount-input" />
              </div>
              <div>
                <Label className="text-emerald-50">Date</Label>
                <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="bg-white text-slate-900" data-testid="accounts-date-input" />
              </div>
              <div>
                <Label className="text-emerald-50">Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="bg-white text-slate-900" placeholder="Short note about this entry" data-testid="accounts-description-input" />
              </div>
              <div>
                <Label className="text-emerald-50">Reference</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} className="bg-white text-slate-900" placeholder="Invoice / voucher / tx id" data-testid="accounts-reference-input" />
              </div>
              <Button type="submit" disabled={busy} className="w-full bg-amber-400 text-emerald-950 hover:bg-amber-300 font-bold rounded-full" data-testid="accounts-save-button">
                {busy ? "Saving..." : "Save Entry"}
              </Button>
            </form>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-display font-bold text-emerald-950 text-xl">Auto-Pulled Income</h2>
              <p className="text-xs text-muted-foreground mt-1">{periodLabel} orders and approved top-ups captured from live backend sources.</p>
            </div>
            <FileClock className="w-5 h-5 text-emerald-700" />
          </div>
          <div className="divide-y divide-border max-h-[26rem] overflow-y-auto">
            {autoIncomeFiltered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No auto income rows found.</p>
            ) : (
              autoIncomeFiltered.map((item) => (
                <div key={item.id} className="py-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-emerald-950 text-sm">{item.label}</p>
                    <p className="text-xs text-muted-foreground capitalize">{item.category} · {item.source}</p>
                  </div>
                  <p className="font-display font-bold text-emerald-700">+{inr(item.amount)}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-display font-bold text-emerald-950 text-xl">Auto-Pulled Expenses</h2>
              <p className="text-xs text-muted-foreground mt-1">{periodLabel} withdrawals and approved MPS claims captured automatically.</p>
            </div>
            <Calculator className="w-5 h-5 text-red-700" />
          </div>
          <div className="divide-y divide-border max-h-[26rem] overflow-y-auto">
            {autoExpenseFiltered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No auto expense rows found.</p>
            ) : (
              autoExpenseFiltered.map((item) => (
                <div key={item.id} className="py-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-emerald-950 text-sm">{item.label}</p>
                    <p className="text-xs text-muted-foreground capitalize">{item.category} · {item.source}</p>
                  </div>
                  <p className="font-display font-bold text-red-700">-{inr(item.amount)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display font-bold text-emerald-950 text-xl">Manual Ledger</h2>
            <p className="text-xs text-muted-foreground mt-1">Custom income/expense rows saved by admin ({periodLabel}).</p>
          </div>
          <div className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded-full font-semibold">{manualEntriesFiltered.length} rows</div>
        </div>
        <div className="divide-y divide-border">
          {manualEntriesFiltered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No manual entries yet.</p>
          ) : (
            manualEntriesFiltered.map((entry) => (
              <div key={entry.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-emerald-950 text-sm">{entry.category}</p>
                  <p className="text-xs text-muted-foreground">{entry.description || "No description"} {entry.reference ? `· ${entry.reference}` : ""}</p>
                  <p className="text-[11px] text-slate-500 mt-1">{entry.date || entry.created_at || ""}</p>
                </div>
                <p className={`font-display font-bold ${entry.direction === "income" ? "text-emerald-700" : "text-red-700"}`}>
                  {entry.direction === "income" ? "+" : "-"}{inr(entry.amount)}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, CalendarCheck2, Clock3, AlertTriangle, Wrench, Save, RotateCcw, Upload, Download, Cloud, Copy } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";

const STORAGE_KEY = "metho_owner_guide_state_v1";
const REMOTE_OWNER_GUIDE_PATHS = [
  "/auth/owner-guide",
  "/auth/preferences/owner-guide",
  "/owner-guide/me",
];

const DAILY_ITEMS = [
  "Orders count, pending withdrawals, failed payments check করুন",
  "Pending approvals clear করুন (partner/product/withdrawal)",
  "1টি sample invoice open করে member data verify করুন",
  "Wallet transactions-এ duplicate বা abnormal debit/credit আছে কিনা দেখুন",
  "দিনের শেষে owner log লিখুন",
];

const WEEKLY_ITEMS = [
  "Paid orders vs wallet inflow basic reconciliation",
  "10টি random member reward sample verify",
  "5টি new referral sample genealogy parent check",
  "Frontend + backend health open test",
];

const WITHDRAWAL_ITEMS = [
  "Member request form-এ estimated deduction দেখাচ্ছে কিনা",
  "Admin queue-তে gross/tds/admin/net breakdown দেখাচ্ছে কিনা",
  "Statement summary-তে withdrawal totals consistent কিনা",
];

const RED_FLAGS = [
  "Payment success but invoice missing",
  "Withdrawal net mismatch without explanation",
  "Unknown admin login/session",
  "Same transaction duplicate credit/debit",
];

const TECH_ITEMS = [
  "Backend API response থেকে secret fields remove",
  "Razorpay secret rotate + old key revoke",
  "Daily DB backup automation + monthly restore drill",
  "Health/failure alert automation setup",
];

const buildDefaultState = () => ({
  businessName: "",
  daily: DAILY_ITEMS.map(() => false),
  weekly: WEEKLY_ITEMS.map(() => false),
  withdrawal: WITHDRAWAL_ITEMS.map(() => false),
  dailyNotes: "",
  weeklyNotes: "",
  technicalNotes: "",
  updatedAt: "",
});

const Checklist = ({ title, items, values, onToggle, testId }) => (
  <div data-testid={testId}>
    <h3 className="font-semibold text-emerald-950 text-sm mb-2">{title}</h3>
    <div className="space-y-2">
      {items.map((item, index) => (
        <label key={item} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 cursor-pointer hover:bg-secondary/30">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-emerald-700"
            checked={!!values[index]}
            onChange={() => onToggle(index)}
          />
          <span className="text-sm text-slate-700">{item}</span>
        </label>
      ))}
    </div>
  </div>
);

export default function OwnerGuidePage() {
  const [state, setState] = useState(buildDefaultState);
  const [syncMode, setSyncMode] = useState("local");
  const [syncCode, setSyncCode] = useState("");
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState("");
  const [purgeReport, setPurgeReport] = useState(null);

  const fetchRemoteState = async () => {
    for (const path of REMOTE_OWNER_GUIDE_PATHS) {
      try {
        const { data } = await api.get(path);
        const remoteState = data?.state || data?.owner_guide_state || data;
        if (remoteState && typeof remoteState === "object") {
          return { found: true, state: remoteState };
        }
      } catch {
        // Silent fallback to local mode.
      }
    }
    return { found: false, state: null };
  };

  const saveRemoteState = async (nextState) => {
    for (const path of REMOTE_OWNER_GUIDE_PATHS) {
      try {
        await api.put(path, { state: nextState });
        return true;
      } catch {
        // Try next candidate path.
      }
    }
    return false;
  };

  useEffect(() => {
    let active = true;

    const boot = async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw && active) {
          const parsed = JSON.parse(raw);
          setState({ ...buildDefaultState(), ...(parsed || {}) });
        }
      } catch {
        if (active) setState(buildDefaultState());
      }

      const remote = await fetchRemoteState();
      if (!active) return;
      if (remote.found && remote.state) {
        setState((prev) => ({ ...buildDefaultState(), ...prev, ...remote.state }));
        setSyncMode("cloud");
      } else {
        setSyncMode("local");
      }
    };

    boot();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const today = useMemo(() => new Date().toLocaleDateString("en-GB"), []);

  const dailyDone = state.daily.filter(Boolean).length;
  const weeklyDone = state.weekly.filter(Boolean).length;
  const withdrawalDone = state.withdrawal.filter(Boolean).length;

  const toggleAt = (key, index) => {
    setState((prev) => {
      const next = Array.isArray(prev[key]) ? [...prev[key]] : [];
      next[index] = !next[index];
      return { ...prev, [key]: next };
    });
  };

  const saveNow = () => {
    const updatedAt = new Date().toLocaleString("en-GB");
    const nextState = { ...state, updatedAt };
    setState(nextState);

    saveRemoteState(nextState).then((ok) => {
      if (ok) {
        setSyncMode("cloud");
        toast.success("Saved to cloud and local device");
      } else {
        setSyncMode("local");
        toast.success("Saved on this device (local mode)");
      }
    });
  };

  const resetAll = () => {
    setState(buildDefaultState());
    toast.success("Checklist reset complete");
  };

  const exportState = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `owner-guide-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Owner guide exported");
  };

  const generateSyncCode = () => {
    try {
      const raw = JSON.stringify(state);
      const encoded = btoa(unescape(encodeURIComponent(raw)));
      setSyncCode(encoded);
      toast.success("Sync code generated");
    } catch {
      toast.error("Could not generate sync code");
    }
  };

  const copySyncCode = async () => {
    if (!syncCode.trim()) {
      toast.error("Generate a sync code first");
      return;
    }
    try {
      await navigator.clipboard.writeText(syncCode.trim());
      toast.success("Sync code copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const applySyncCode = () => {
    const code = String(syncCode || "").trim();
    if (!code) {
      toast.error("Paste sync code first");
      return;
    }
    try {
      const decoded = decodeURIComponent(escape(atob(code)));
      const parsed = JSON.parse(decoded);
      const merged = { ...buildDefaultState(), ...(parsed || {}) };
      setState(merged);
      toast.success("Sync code applied");
    } catch {
      toast.error("Invalid sync code");
    }
  };

  const deletePartnerById = async (partnerId) => {
    const requests = [
      () => api.delete(`/admin/partners/${partnerId}/permanent`),
      () => api.delete(`/admin/partners/${partnerId}?permanent=true`),
      () => api.post(`/admin/partners/${partnerId}/permanent`),
      () => api.post(`/admin/partners/${partnerId}/delete`, { permanent: true }),
    ];
    for (const run of requests) {
      try {
        await run();
        return true;
      } catch {
        // Try next route.
      }
    }
    return false;
  };

  const purgeMembers = async () => {
    try {
      const { data } = await api.get("/admin/users", { params: { role: "member" } });
      const list = Array.isArray(data) ? data : [];
      let removed = 0;
      let blocked = 0;
      const failed = [];

      for (const member of list) {
        const memberId = member?.id;
        if (!memberId) continue;
        const deleteRoutes = [
          () => api.delete(`/admin/users/${memberId}`),
          () => api.delete(`/admin/users/${memberId}/permanent`),
          () => api.post(`/admin/users/${memberId}/delete`, { permanent: true }),
        ];

        let done = false;
        for (const run of deleteRoutes) {
          try {
            await run();
            removed += 1;
            done = true;
            break;
          } catch {
            // try next delete route
          }
        }
        if (done) continue;

        try {
          if (member?.active !== false) {
            await api.post(`/admin/users/${memberId}/toggle-active`);
            blocked += 1;
            done = true;
          }
        } catch {
          // ignore
        }

        if (!done) {
          failed.push(member?.member_code || member?.email || String(memberId));
        }
      }

      return { total: list.length, removed, blocked, failed };
    } catch {
      return { total: 0, removed: 0, blocked: 0, failed: ["member-list-load-failed"] };
    }
  };

  const purgePartners = async () => {
    try {
      const { data } = await api.get("/admin/partners");
      const list = Array.isArray(data) ? data : [];
      let removed = 0;
      const failed = [];

      for (const partner of list) {
        const ok = await deletePartnerById(partner?.id);
        if (ok) removed += 1;
        else failed.push(partner?.partner_code || partner?.business_name || String(partner?.id || "unknown"));
      }

      return { total: list.length, removed, failed };
    } catch {
      return { total: 0, removed: 0, failed: ["partner-list-load-failed"] };
    }
  };

  const runSystemCheckAndPurge = async () => {
    if (purgeBusy) return;
    if (String(purgeConfirmText || "").trim().toUpperCase() !== "DELETE ALL TEST DATA") {
      toast.error("Type exact confirmation: DELETE ALL TEST DATA");
      return;
    }

    setPurgeBusy(true);
    setPurgeReport(null);
    try {
      const checks = { partnerDirectory: false, partnerGallery: false, partnerProductsApi: false };

      try {
        await api.get("/directory/partners");
        checks.partnerDirectory = true;
      } catch {
        checks.partnerDirectory = false;
      }
      try {
        await api.get("/partner/products");
        checks.partnerProductsApi = true;
      } catch {
        checks.partnerProductsApi = false;
      }
      try {
        await api.get("/settings");
        checks.partnerGallery = true;
      } catch {
        checks.partnerGallery = false;
      }

      const [partnerResult, memberResult] = await Promise.all([purgePartners(), purgeMembers()]);

      const report = {
        checkedAt: new Date().toLocaleString("en-GB"),
        checks,
        partners: partnerResult,
        members: memberResult,
      };
      setPurgeReport(report);
      const hasFailure = (partnerResult.failed?.length || 0) > 0 || (memberResult.failed?.length || 0) > 0;
      if (hasFailure) {
        toast.error("Purge completed with some failures. See report below.");
      } else {
        toast.success("System check done and test data purge completed");
      }
      setPurgeConfirmText("");
    } finally {
      setPurgeBusy(false);
    }
  };

  const importState = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const merged = { ...buildDefaultState(), ...(parsed || {}) };
      setState(merged);
      toast.success("Owner guide imported");
    } catch {
      toast.error("Invalid JSON file");
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-6" data-testid="owner-guide-page">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Owner Mode</p>
        <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Solo Operation Guide</h1>
        <p className="text-sm text-muted-foreground font-body mt-1">VS Code না খুলেই daily system check, security discipline, আর জরুরি সময়ে কী করবেন - সব এখানে।</p>
      </div>

      <section className="bg-white rounded-xl border border-border p-5" data-testid="owner-guide-control-panel">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Business Name</p>
            <input
              value={state.businessName}
              onChange={(e) => setState((prev) => ({ ...prev, businessName: e.target.value }))}
              placeholder="আপনার business name লিখুন"
              className="mt-1.5 h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-300"
              data-testid="owner-guide-business-name"
            />
          </div>
          <div className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm">
            <p>Date: <span className="font-semibold">{today}</span></p>
            <p>Last saved: <span className="font-semibold">{state.updatedAt || "Not saved yet"}</span></p>
            <p>Sync: <span className="font-semibold capitalize">{syncMode}</span></p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={saveNow} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-950" data-testid="owner-guide-save-btn">
            <Save className="w-3.5 h-3.5" /> Save Today
          </button>
          <button onClick={exportState} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50" data-testid="owner-guide-export-btn">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <label className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 cursor-pointer" data-testid="owner-guide-import-btn">
            <Upload className="w-3.5 h-3.5" /> Import
            <input type="file" accept="application/json" className="hidden" onChange={importState} />
          </label>
          <button onClick={resetAll} className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50" data-testid="owner-guide-reset-btn">
            <RotateCcw className="w-3.5 h-3.5" /> Reset Checklist
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500 flex items-center gap-1.5">
          <Cloud className="w-3.5 h-3.5" /> Cloud endpoint available হলে same account-এ multi-device sync auto হবে, না হলে local mode + export/import ব্যবহার করুন।
        </p>

        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3" data-testid="owner-guide-sync-code-box">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">No-Team Device Sync</p>
          <p className="mt-1 text-[11px] text-slate-600">Device-1 এ Generate করুন, code copy করে Device-2 তে paste করে Apply করুন।</p>
          <textarea
            value={syncCode}
            onChange={(e) => setSyncCode(e.target.value)}
            placeholder="Sync code এখানে আসবে / এখানে paste করুন"
            className="mt-2 w-full rounded-md border border-input bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-300"
            rows={3}
            data-testid="owner-guide-sync-code"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={generateSyncCode} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-950" data-testid="owner-guide-generate-sync-btn">
              Generate Code
            </button>
            <button onClick={copySyncCode} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50" data-testid="owner-guide-copy-sync-btn">
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
            <button onClick={applySyncCode} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50" data-testid="owner-guide-apply-sync-btn">
              Apply Code
            </button>
          </div>
        </div>
      </section>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" data-testid="owner-guide-fast-rule">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Golden Rule</p>
        <p className="mt-1 text-sm text-emerald-900">একবারে একটি change করুন, তারপর verify করুন। Build/verification ছাড়া production change করবেন না।</p>
      </div>

      <section className="bg-white rounded-xl border border-border p-5" data-testid="owner-guide-daily">
        <div className="flex items-center gap-2 mb-3">
          <Clock3 className="w-4 h-4 text-emerald-800" />
          <h2 className="font-display font-bold text-emerald-950 text-lg">Daily Checklist (15-20 min) - {dailyDone}/{DAILY_ITEMS.length}</h2>
        </div>
        <Checklist
          title="আজকের কাজ"
          items={DAILY_ITEMS}
          values={state.daily}
          onToggle={(index) => toggleAt("daily", index)}
          testId="owner-guide-daily-checklist"
        />
        <textarea
          value={state.dailyNotes}
          onChange={(e) => setState((prev) => ({ ...prev, dailyNotes: e.target.value }))}
          placeholder="Daily note: আজ কী issue পেয়েছেন, কী action নিয়েছেন"
          className="mt-3 w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300"
          rows={4}
          data-testid="owner-guide-daily-notes"
        />
      </section>

      <section className="bg-white rounded-xl border border-border p-5" data-testid="owner-guide-weekly">
        <div className="flex items-center gap-2 mb-3">
          <CalendarCheck2 className="w-4 h-4 text-emerald-800" />
          <h2 className="font-display font-bold text-emerald-950 text-lg">Weekly Checklist (60-90 min) - {weeklyDone}/{WEEKLY_ITEMS.length}</h2>
        </div>
        <Checklist
          title="সপ্তাহিক কাজ"
          items={WEEKLY_ITEMS}
          values={state.weekly}
          onToggle={(index) => toggleAt("weekly", index)}
          testId="owner-guide-weekly-checklist"
        />
        <textarea
          value={state.weeklyNotes}
          onChange={(e) => setState((prev) => ({ ...prev, weeklyNotes: e.target.value }))}
          placeholder="Weekly note: reconciliation result, anomaly, pending action"
          className="mt-3 w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300"
          rows={4}
          data-testid="owner-guide-weekly-notes"
        />
      </section>

      <section className="bg-white rounded-xl border border-border p-5" data-testid="owner-guide-withdrawal">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-emerald-800" />
          <h2 className="font-display font-bold text-emerald-950 text-lg">Withdrawal SOP - {withdrawalDone}/{WITHDRAWAL_ITEMS.length}</h2>
        </div>
        <p className="text-sm text-slate-700">Target model: Gross -> TDS 5% -> Admin Charge 3% -> Net Payout</p>
        <div className="mt-2">
          <Checklist
            title="Withdrawal verification"
            items={WITHDRAWAL_ITEMS}
            values={state.withdrawal}
            onToggle={(index) => toggleAt("withdrawal", index)}
            testId="owner-guide-withdrawal-checklist"
          />
        </div>
      </section>

      <section className="bg-white rounded-xl border border-border p-5" data-testid="owner-guide-red-flag">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-red-700" />
          <h2 className="font-display font-bold text-emerald-950 text-lg">Red Flags (Immediately Hold)</h2>
        </div>
        <ul className="space-y-2 list-disc pl-5">
          {RED_FLAGS.map((flag) => (
            <li key={flag} className="text-sm text-slate-700">{flag}</li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-xl border border-border p-5" data-testid="owner-guide-technical-needed">
        <div className="flex items-center gap-2 mb-3">
          <Wrench className="w-4 h-4 text-amber-700" />
          <h2 className="font-display font-bold text-emerald-950 text-lg">Technical Help লাগবে যেগুলোতে</h2>
        </div>
        <ul className="space-y-2 list-disc pl-5">
          {TECH_ITEMS.map((item) => (
            <li key={item} className="text-sm text-slate-700">{item}</li>
          ))}
        </ul>
        <textarea
          value={state.technicalNotes}
          onChange={(e) => setState((prev) => ({ ...prev, technicalNotes: e.target.value }))}
          placeholder="Technical task follow-up note: কাকে দিয়েছিলেন, status, proof"
          className="mt-3 w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300"
          rows={4}
          data-testid="owner-guide-technical-notes"
        />
      </section>

      <section className="bg-white rounded-xl border border-red-200 p-5" data-testid="owner-guide-purge-panel">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-red-700" />
          <h2 className="font-display font-bold text-emerald-950 text-lg">Reset Test Data (Partners + Members)</h2>
        </div>
        <p className="text-sm text-slate-700">এটা current admin account দিয়ে system check run করে partner/member test registrations purge করবে।</p>
        <p className="text-xs text-red-700 mt-1">Warning: এই action irreversible হতে পারে। Real data থাকলে চালাবেন না।</p>

        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            value={purgeConfirmText}
            onChange={(e) => setPurgeConfirmText(e.target.value)}
            placeholder="Type: DELETE ALL TEST DATA"
            className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-300"
            data-testid="owner-guide-purge-confirm-input"
          />
          <button
            onClick={runSystemCheckAndPurge}
            disabled={purgeBusy}
            className="inline-flex items-center justify-center rounded-full bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
            data-testid="owner-guide-purge-run-btn"
          >
            {purgeBusy ? "Running..." : "Run Check + Purge"}
          </button>
        </div>

        {purgeReport ? (
          <div className="mt-3 rounded-lg border border-border bg-slate-50 p-3 text-xs" data-testid="owner-guide-purge-report">
            <p><span className="font-semibold">Checked at:</span> {purgeReport.checkedAt}</p>
            <p className="mt-1"><span className="font-semibold">Partner flow checks:</span> directory {purgeReport.checks.partnerDirectory ? "OK" : "FAIL"}, products API {purgeReport.checks.partnerProductsApi ? "OK" : "FAIL"}, settings {purgeReport.checks.partnerGallery ? "OK" : "FAIL"}</p>
            <p className="mt-1"><span className="font-semibold">Partners:</span> total {purgeReport.partners.total}, removed {purgeReport.partners.removed}, failed {(purgeReport.partners.failed || []).length}</p>
            <p><span className="font-semibold">Members:</span> total {purgeReport.members.total}, removed {purgeReport.members.removed}, blocked {purgeReport.members.blocked}, failed {(purgeReport.members.failed || []).length}</p>
            {(purgeReport.partners.failed || []).length > 0 || (purgeReport.members.failed || []).length > 0 ? (
              <pre className="mt-2 whitespace-pre-wrap break-words">{JSON.stringify({ partnerFailed: purgeReport.partners.failed, memberFailed: purgeReport.members.failed }, null, 2)}</pre>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

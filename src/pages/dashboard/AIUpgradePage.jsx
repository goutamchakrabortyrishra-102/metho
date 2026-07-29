import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { Bot, ShieldAlert, Sparkles, Wrench, FileCode2, CheckCircle2, Clock3, XCircle, Eye } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const STATUS_META = {
  draft_plan: { label: "Draft Plan", className: "bg-slate-100 text-slate-700" },
  approved_for_build: { label: "Approved", className: "bg-emerald-100 text-emerald-800" },
  needs_review: { label: "Needs Review", className: "bg-amber-100 text-amber-800" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-700" },
  completed: { label: "Completed", className: "bg-blue-100 text-blue-700" },
};

const READY_PROMPTS_BN = [
  {
    id: "bulk-fix",
    title: "Bulk Product Upload Calculation Fix (Safe)",
    prompt: `শুধু Bulk Product Upload-এর calculation logic fix করুন। অন্য কোনো page, layout, route বা feature touch করবেন না।

সমস্যা:
- bulk JSON-এ price ফাঁকা (\"\") থাকলে rate/selling_price/unit_price থেকে fallback নিচ্ছে না
- mrp/list_price/max_price fallback কিছু row-এ কাজ করছে না
- discount_percent/discount/discount_pct fallback uniform না
- gst_percent/gst/gst_rate fallback stable না

চাই:
1) first non-empty value fallback logic দিন (null/undefined/\"\")
2) price missing হলে mrp+discount থেকে price auto-calc
3) mrp missing হলে price = mrp ধরে নিন
4) discount missing হলে (mrp-price)/mrp * 100 থেকে derive করুন
5) invalid row clear error message দিন (row number সহ)

Strict scope:
- শুধু AddProductDialog-এর bulk import path change
- single product create/edit flow change করবেন না
- UI design/style change করবেন না

Validation mandatory:
- npm run build pass
- existing flow break না হওয়া confirm
- sample bulk JSON দিয়ে test result দেখান:
  a) price=\"\" + rate আছে → create success
  b) price=\"\" + mrp+discount আছে → auto price ঠিক
  c) mrp=\"\" + price আছে → mrp auto set`,
  },
  {
    id: "feature-add",
    title: "Small Feature Add (No Layout Break)",
    prompt: `নতুন ছোট feature add করুন, কিন্তু existing layout/flow ভাঙবেন না।

Task example:
- Partner dashboard এ shop link copy + WhatsApp share button add করুন

Rules:
- minimal code change
- existing styles follow করবেন
- নতুন error introduce করবেন না

শেষে দিন:
1) কোন file change হয়েছে
2) build result
3) live verify checklist`,
  },
  {
    id: "search-filter",
    title: "Search/Filter Improvement",
    prompt: `Search/filter logic উন্নত করুন।

Task example:
- Service search এ business name, service name, category তিনটাতেই match করুন

Rules:
- existing API structure change করবেন না
- UI layout unchanged রাখুন
- case-insensitive search দিন

শেষে দিন:
- before/after behavior
- test steps`,
  },
  {
    id: "form-validation",
    title: "Form Validation & Field Rules",
    prompt: `Form validation rule add/update করুন।

Task example:
- associate_partner product এ partner_id mandatory করুন

Rules:
- clear validation message দেখাতে হবে
- submit block হবে invalid হলে
- single create/edit flow break করা যাবে না`,
  },
  {
    id: "ui-text-update",
    title: "UI Text Update Only",
    prompt: `শুধু UI text/content update করুন, layout/design change করবেন না।

Rules:
- heading/label/button text only
- spacing, sizing, colors unchanged
- অন্য page touch করবেন না

শেষে changed text list দিন।`,
  },
  {
    id: "route-access",
    title: "Route & Access Check",
    prompt: `admin/partner/member route access verify/fix করুন।

Check:
- protected routes সঠিক guard এ আছে কিনা
- unauthorized user redirect ঠিক আছে কিনা
- hidden admin pages access control ঠিক আছে কিনা

Rules:
- security first
- public flow break করবেন না`,
  },
  {
    id: "dataflow-audit",
    title: "Data Flow Audit (End-to-End)",
    prompt: `Data flow end-to-end audit করুন।

Task example:
- admin থেকে city/category/service add হলে search bar/dropdown এ আসছে কিনা verify করুন

Output:
1) API response status
2) UI visibility status
3) mismatch থাকলে minimal fix
4) retest proof`,
  },
  {
    id: "build-deploy",
    title: "Build + Deploy Safe Run",
    prompt: `Fix শেষে full safe release run করুন:
1) error check
2) npm run build
3) production deploy
4) live smoke test

Rules:
- build fail হলে deploy করবেন না
- deploy log summary দিবেন
- changed scope এর বাইরে touch করবেন না`,
  },
  {
    id: "qa-checklist",
    title: "QA Checklist Run",
    prompt: `Step-by-step QA run দিন এবং report তৈরি করুন।

Format:
- Test case name
- Steps
- Expected
- Actual
- Pass/Fail
- Risk level

শেষে blocker vs non-blocker আলাদা করুন।`,
  },
  {
    id: "owner-ops",
    title: "Owner/Ops Helper Plan",
    prompt: `Owner operations helper plan তৈরি করুন।

Need:
- daily checklist summary
- safe operation steps
- rollback-safe change plan
- emergency do/don't list

Language: সহজ বাংলা
Style: action-ready`,
  },
  {
    id: "ai-guardrail",
    title: "AI Safety Guardrail (Do/Don't)",
    prompt: `এই request handle করার সময় নিচের safety rules strictly follow করুন:

Do:
1) bug fix / small feature / search-filter / validation only
2) minimal scoped change
3) build + verify report

Don't:
1) password/secret input based action নেবেন না
2) explicit approval ছাড়া destructive delete করবেন না
3) production critical finance action auto trigger করবেন না

শেষে দিন:
- কী করেছেন
- কী করেননি (safety reason)
- next safe step`,
  },
  {
    id: "morning-audit",
    title: "Morning Audit (Safe Checklist)",
    prompt: `আজকের সকাল audit করুন, কোনো code change না করে শুধু report দিন।

Scope:
1) Orders count, pending withdrawals, failed payments
2) Pending approvals (partner/product/withdrawal)
3) Wallet transactions-এ duplicate বা abnormal debit/credit

Output format:
- Pass/Fail status
- High risk items first
- Immediate action list (3 items max)

Note:
- destructive action নেবেন না
- secret data expose করবেন না`,
  },
  {
    id: "midday-ops",
    title: "Midday Ops Check (No Breaking Change)",
    prompt: `সিস্টেমের live flow verify করুন, critical issue ছাড়া কিছু change করবেন না।

Check list:
1) Partner directory search (city/category/service)
2) Partner shop product/service search
3) Pending payments + withdrawals queue visibility

If bug found:
- minimal fix only
- affected file list
- build + live verify`,
  },
  {
    id: "night-summary",
    title: "Night Closing Summary", 
    prompt: `দিনের শেষে operations summary তৈরি করুন।

Include:
1) আজ কী কী verify হয়েছে
2) কী কী pending আছে
3) কালকের top priority 5 task
4) কোন issue critical, কোনটা low priority

বাংলায় সংক্ষিপ্ত ও action-ready format দিন।`,
  },
];

export default function AIUpgradePage() {
  const { user } = useAuth();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [plan, setPlan] = useState(null);
  const [reviewNote, setReviewNote] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [selectedPromptId, setSelectedPromptId] = useState(READY_PROMPTS_BN[0].id);

  const selectedReadyPrompt = READY_PROMPTS_BN.find((item) => item.id === selectedPromptId) || READY_PROMPTS_BN[0];

  const copyReadyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(selectedReadyPrompt.prompt);
      toast.success("Ready Bangla prompt copied");
    } catch {
      toast.error("Prompt copy failed");
    }
  };

  const useReadyPrompt = () => {
    setTitle(selectedReadyPrompt.title);
    setPrompt(selectedReadyPrompt.prompt);
    toast.success("Ready prompt inserted");
  };

  const loadHistory = async () => {
    try {
      const { data } = await api.get("/admin/ai-upgrade/requests");
      setHistory(data || []);
      if (!plan && data?.length) {
        setPlan(data[0]);
        setReviewNote(data[0].admin_note || "");
      }
    } catch {
      toast.error("AI request history load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadHistory();
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/app" replace />;

  const submitPrompt = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) {
      toast.error("Enter a Bangla or English prompt");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post("/admin/ai-upgrade/plan", {
        title: title.trim() || undefined,
        prompt: prompt.trim(),
      });
      setPlan(data);
      setReviewNote("");
      setPrompt("");
      setTitle("");
      toast.success("AI upgrade plan generated");
      loadHistory();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "AI plan generation failed");
    } finally {
      setSaving(false);
    }
  };

  const selectPlan = (item) => {
    setPlan(item);
    setReviewNote(item.admin_note || "");
  };

  const updateStatus = async (status) => {
    if (!plan?.id) return;
    setUpdatingStatus(true);
    try {
      const { data } = await api.post(`/admin/ai-upgrade/requests/${plan.id}/status`, {
        status,
        admin_note: reviewNote,
      });
      setPlan(data);
      setHistory((current) => current.map((item) => (item.id === data.id ? data : item)));
      toast.success(`Request marked as ${STATUS_META[status]?.label || status}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Status update failed");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const generateDraftPatch = async () => {
    if (!plan?.id) return;
    setGeneratingDraft(true);
    try {
      const { data } = await api.post(`/admin/ai-upgrade/requests/${plan.id}/generate-draft`, {});
      setPlan(data);
      setHistory((current) => current.map((item) => (item.id === data.id ? data : item)));
      toast.success("Draft patch preview generated");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Draft patch generation failed");
    } finally {
      setGeneratingDraft(false);
    }
  };

  const planStatus = STATUS_META[plan?.status] || STATUS_META.draft_plan;

  return (
    <div className="space-y-6" data-testid="ai-upgrade-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin AI</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">AI Upgrade Console</h1>
          <p className="text-sm text-muted-foreground font-body mt-1 max-w-3xl">
            Write your request in Bangla or English. In this phase the AI creates a safe change plan, shows the affected modules, estimates risk, and prepares a validation checklist.
          </p>
        </div>
        <div className="rounded-full bg-amber-100 text-amber-800 px-4 py-2 text-xs font-bold uppercase tracking-wider">
          Safe Mode Only
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-6">
          <form onSubmit={submitPrompt} className="bg-white rounded-2xl border border-border p-6 space-y-4" data-testid="ai-upgrade-form">
            <div className="flex items-center gap-3 text-emerald-950">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                <Bot className="w-5 h-5 text-emerald-800" />
              </div>
              <div>
                <h2 className="font-display font-bold text-xl">Prompt to Plan</h2>
                <p className="text-xs text-muted-foreground">Example: add OTP to withdrawal approval, or create a partner performance report.</p>
              </div>
            </div>

            <div>
              <Label>Short Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Add OTP for withdrawal approval"
                className="mt-1.5"
                data-testid="ai-upgrade-title"
              />
            </div>

            <div>
              <Label>Admin Prompt</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={8}
                placeholder="Write your change request in Bangla or English..."
                className="mt-1.5"
                data-testid="ai-upgrade-prompt"
              />
            </div>

            <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1">Feature add</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">Bug fix</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">Logic update</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">Risk summary</span>
            </div>

            <Button type="submit" disabled={saving} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="ai-upgrade-submit">
              {saving ? "Generating..." : "Generate Upgrade Plan"}
            </Button>
          </form>

          {plan ? (
            <div className="bg-white rounded-2xl border border-border p-6 space-y-5" data-testid="ai-upgrade-plan-result">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Latest Plan</p>
                  <h2 className="font-display font-black text-2xl text-emerald-950 mt-1">{plan.title}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{plan.summary}</p>
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <div className={"rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider " + (plan.risk_level === "high" ? "bg-red-100 text-red-700" : plan.risk_level === "moderate" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")}>
                    {plan.risk_level} risk
                  </div>
                  <div className={"rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider " + planStatus.className} data-testid="ai-plan-status">
                    {planStatus.label}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl bg-secondary/40 p-4">
                  <div className="flex items-center gap-2 mb-2 text-emerald-950">
                    <Sparkles className="w-4 h-4" />
                    <h3 className="font-semibold">Affected Areas</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {plan.affected_areas?.map((item) => (
                      <span key={item} className="rounded-full bg-white border border-border px-3 py-1 text-xs font-semibold text-slate-700">{item}</span>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl bg-secondary/40 p-4">
                  <div className="flex items-center gap-2 mb-2 text-emerald-950">
                    <ShieldAlert className="w-4 h-4" />
                    <h3 className="font-semibold">Validation Checks</h3>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-700">
                    {plan.validation_checks?.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center gap-2 mb-2 text-emerald-950">
                    <Wrench className="w-4 h-4" />
                    <h3 className="font-semibold">Recommended Steps</h3>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-700">
                    {plan.recommended_steps?.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center gap-2 mb-2 text-emerald-950">
                    <ShieldAlert className="w-4 h-4" />
                    <h3 className="font-semibold">Watchdog Actions</h3>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-700">
                    {plan.watchdog_actions?.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center gap-2 mb-2 text-emerald-950">
                    <FileCode2 className="w-4 h-4" />
                    <h3 className="font-semibold">Suggested Files</h3>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-700 font-mono break-all">
                    {plan.suggested_files?.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center gap-2 mb-2 text-emerald-950">
                    <Sparkles className="w-4 h-4" />
                    <h3 className="font-semibold">Implementation Brief</h3>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-700">
                    {plan.implementation_brief?.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 space-y-4" data-testid="ai-draft-patch-preview">
                <div className="flex items-center gap-2 text-emerald-950">
                  <FileCode2 className="w-4 h-4" />
                  <h3 className="font-semibold">Draft Patch Preview</h3>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    {plan.draft_patch_generated_at ? `Generated at ${new Date(plan.draft_patch_generated_at).toLocaleString()}` : "No draft patch preview generated yet."}
                  </p>
                  <Button
                    type="button"
                    onClick={generateDraftPatch}
                    disabled={generatingDraft}
                    className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full"
                    data-testid="ai-generate-draft-button"
                  >
                    {generatingDraft ? "Generating..." : "Generate Draft Patch"}
                  </Button>
                </div>
                <div className="space-y-4">
                  {plan.draft_patch_preview?.length ? plan.draft_patch_preview.map((item) => (
                    <div key={item.file} className="rounded-xl bg-secondary/40 p-4">
                      <p className="font-semibold text-emerald-950 break-all">{item.file}</p>
                      <p className="text-xs text-slate-500 mt-1">{item.purpose}</p>
                      <ul className="mt-3 space-y-2 text-sm text-slate-700">
                        {item.planned_changes?.map((change) => <li key={change}>• {change}</li>)}
                      </ul>
                      <div className="mt-3 rounded-lg bg-slate-950 text-slate-100 p-3 font-mono text-xs space-y-1 overflow-x-auto">
                        {item.pseudo_diff?.map((line) => <div key={line}>{line}</div>)}
                      </div>
                    </div>
                  )) : <p className="text-sm text-slate-500">Generate draft patch preview to inspect planned file-by-file changes.</p>}
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">Preview Notes</p>
                  <ul className="mt-2 space-y-2 text-sm text-amber-900">
                    {(plan.draft_patch_notes?.length ? plan.draft_patch_notes : ["Draft patch preview has not been generated yet."]).map((note) => <li key={note}>• {note}</li>)}
                  </ul>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Test Preview</p>
                  <div className="mt-3 space-y-3">
                    {plan.test_preview?.length ? plan.test_preview.map((test) => (
                      <div key={test.name} className="rounded-lg bg-secondary/40 p-3">
                        <p className="font-semibold text-emerald-950 text-sm">{test.name}</p>
                        <p className="text-xs text-slate-500 mt-1">{test.scope}</p>
                        <p className="text-sm text-slate-700 mt-2">{test.why}</p>
                      </div>
                    )) : <p className="text-sm text-slate-500">Test preview will appear after draft generation.</p>}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 space-y-4">
                <div className="flex items-center gap-2 text-emerald-950">
                  <ShieldAlert className="w-4 h-4" />
                  <h3 className="font-semibold">Approval Workflow</h3>
                </div>
                <div>
                  <Label>Admin Review Note</Label>
                  <Textarea
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    rows={3}
                    className="mt-1.5"
                    data-testid="ai-upgrade-review-note"
                    placeholder="Write review or deployment notes..."
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={updatingStatus} onClick={() => updateStatus("approved_for_build")} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="ai-approve-button">
                    <CheckCircle2 className="w-4 h-4 mr-2" /> Approve for Build
                  </Button>
                  <Button type="button" disabled={updatingStatus} onClick={() => updateStatus("needs_review")} variant="outline" className="rounded-full" data-testid="ai-review-button">
                    <Eye className="w-4 h-4 mr-2" /> Needs Review
                  </Button>
                  <Button type="button" disabled={updatingStatus} onClick={() => updateStatus("completed")} variant="outline" className="rounded-full" data-testid="ai-complete-button">
                    <Clock3 className="w-4 h-4 mr-2" /> Mark Complete
                  </Button>
                  <Button type="button" disabled={updatingStatus} onClick={() => updateStatus("rejected")} variant="outline" className="rounded-full border-red-200 text-red-700 hover:bg-red-50" data-testid="ai-reject-button">
                    <XCircle className="w-4 h-4 mr-2" /> Reject
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-border p-6" data-testid="ai-upgrade-ready-prompt-bn">
            <h2 className="font-display font-bold text-xl text-emerald-950">Bangla Ready Prompt</h2>
            <p className="text-xs text-muted-foreground mt-1">যখন খুশি copy করে paste করতে পারবেন, অথবা এক ক্লিকে নিচের Admin Prompt box-এ বসাতে পারবেন।</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {READY_PROMPTS_BN.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant={selectedPromptId === item.id ? "default" : "outline"}
                  className={selectedPromptId === item.id ? "bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" : "rounded-full"}
                  onClick={() => setSelectedPromptId(item.id)}
                  data-testid={`ai-upgrade-ready-prompt-tab-${item.id}`}
                >
                  {item.title}
                </Button>
              ))}
            </div>
            <div className="mt-4 rounded-xl bg-secondary/40 border border-border p-4">
              <p className="text-[11px] uppercase tracking-wider text-emerald-800 font-semibold">Short Title</p>
              <p className="text-sm font-semibold text-emerald-950 mt-1">{selectedReadyPrompt.title}</p>
              <p className="text-[11px] uppercase tracking-wider text-emerald-800 font-semibold mt-4">Admin Prompt</p>
              <pre className="mt-1 text-xs text-slate-700 whitespace-pre-wrap font-body">{selectedReadyPrompt.prompt}</pre>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-full" onClick={copyReadyPrompt} data-testid="ai-upgrade-copy-ready-prompt">
                Copy Prompt
              </Button>
              <Button type="button" className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" onClick={useReadyPrompt} data-testid="ai-upgrade-use-ready-prompt">
                Use in Prompt Box
              </Button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-border p-6" data-testid="ai-upgrade-history">
            <h2 className="font-display font-bold text-xl text-emerald-950">Recent Requests</h2>
            <p className="text-xs text-muted-foreground mt-1">Latest prompt-based upgrade plans from admin.</p>
            <div className="mt-4 space-y-3">
              {loading ? <p className="text-sm text-slate-500">Loading...</p> : null}
              {!loading && history.length === 0 ? <p className="text-sm text-slate-500">No AI upgrade requests yet.</p> : null}
              {history.slice(0, 8).map((item) => (
                <button key={item.id} type="button" onClick={() => selectPlan(item)} className={"w-full text-left rounded-xl border p-4 transition-colors " + (plan?.id === item.id ? "border-emerald-400 bg-emerald-50/50" : "border-border bg-white hover:bg-slate-50")} data-testid={`ai-history-${item.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-emerald-950 text-sm">{item.title}</p>
                      <p className="text-[11px] text-slate-500 mt-1 uppercase tracking-wider">{item.change_type} · {item.language} · {(STATUS_META[item.status] || STATUS_META.draft_plan).label}</p>
                    </div>
                    <span className={"rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider " + (item.risk_level === "high" ? "bg-red-100 text-red-700" : item.risk_level === "moderate" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")}>
                      {item.risk_level}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-2 line-clamp-3">{item.prompt}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function WhatsAppAISettingsPage() {
  const { user } = useAuth();
  const isAdmin = ["super_admin", "company_admin", "admin"].includes(user?.role);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    api.get("/admin/crm/whatsapp-ai/settings").then(({ data }) => setForm(data)).catch(() => toast.error("WhatsApp AI settings could not be loaded"));
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/app" replace />;
  if (!form) return <div className="p-6 text-sm text-slate-500">Loading WhatsApp AI settings...</div>;
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));
  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/admin/crm/whatsapp-ai/settings", form);
      setForm(data);
      toast.success("WhatsApp AI settings saved");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "WhatsApp AI settings could not be saved");
    } finally { setSaving(false); }
  };

  return <div className="mx-auto max-w-4xl space-y-5">
    <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">METHO Business CRM</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-900"><Settings2 className="h-6 w-6" /> WhatsApp AI</h1><p className="mt-1 text-sm text-slate-600">AI creates drafts only. An admin must review and send every reply.</p></div>
    <div className="space-y-5 border border-border bg-white p-5">
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.enabled === true} onChange={update("enabled")} /> Enable AI reply suggestions</label>
      <div className="grid gap-4 md:grid-cols-2"><div><Label>Provider</Label><select value={form.provider} onChange={update("provider")} className="mt-1.5 h-10 w-full rounded-md border border-input px-3 text-sm"><option value="openai">OpenAI</option><option value="gemini">Gemini</option></select></div><div><Label>Model</Label><Input value={form.model} onChange={update("model")} className="mt-1.5" /></div></div>
      <div><Label>System prompt</Label><Textarea value={form.system_prompt} onChange={update("system_prompt")} rows={6} className="mt-1.5" /></div>
      <div><Label>Knowledge base</Label><Textarea value={form.knowledge_base} onChange={update("knowledge_base")} rows={8} className="mt-1.5" /></div>
      <div><Label>Human handoff keywords</Label><Input value={form.handoff_keywords} onChange={update("handoff_keywords")} className="mt-1.5" /></div>
      <div className="flex justify-end"><Button onClick={save} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? "Saving..." : "Save settings"}</Button></div>
    </div>
  </div>;
}
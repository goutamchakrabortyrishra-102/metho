import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Save, Settings2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const presetGroups = [
  { title: "Core replies", fields: [["default_auto_reply", "Default auto reply"], ["customer_auto_reply", "Customer auto reply"], ["member_auto_reply", "Member auto reply"], ["partner_auto_reply", "Partner auto reply"], ["invoice_template", "Invoice message template"], ["order_template", "Order message template"], ["preset_support_fallback", "Support / Executive fallback"], ["preset_business_enquiry_executive", "Business / plan / income Executive reply"], ["preset_handoff_requested", "Human handoff requested"]] },
  { title: "Registration entry", fields: [["registration_welcome_message", "Registration welcome"], ["registration_url", "General registration URL"], ["registration_help_prompt", "Registration help"], ["registration_role_question", "Role selection question"], ["preset_registration_intro", "WhatsApp introduction"], ["preset_metho_info", "METHO information reply"], ["preset_icebreaker_metho_info", "Icebreaker METHO info"], ["preset_icebreaker_shop_partner", "Icebreaker shop or partner"], ["preset_icebreaker_customer_support", "Icebreaker customer support"], ["preset_member_role_explanation", "Member role explanation"], ["preset_partner_role_explanation", "Partner role explanation"], ["preset_rider_role_explanation", "Rider role explanation"], ["preset_role_selection_fallback", "Role selection fallback"]] },
  { title: "Member registration", fields: [["member_registration_url", "Member registration URL"], ["member_registration_reply", "Member website form reply"], ["member_registration_keywords", "Member reply keywords"], ["preset_member_registration_start", "Member website form start"], ["preset_member_registration_success", "Member registration success"], ["preset_member_registration_failed", "Member registration failed"], ["preset_member_activation_pending", "Member activation pending"], ["preset_member_active_reply", "Member active reply"], ["preset_member_onboarding_started", "Member onboarding started"], ["preset_order_status_header", "Order status header"], ["preset_no_orders_found", "No orders found"]] },
  { title: "Partner registration", fields: [["partner_registration_url", "Partner registration URL"], ["partner_registration_reply", "Partner website form reply"], ["partner_registration_keywords", "Partner reply keywords"], ["preset_partner_registration_start", "Partner website form start"], ["preset_partner_submitted", "Partner submitted"], ["preset_partner_pending_status", "Partner pending status"], ["preset_partner_pending_approved", "Partner pending approved"], ["preset_partner_approved_reply", "Partner approved reply"], ["preset_partner_rejected_reply", "Partner rejected reply"], ["preset_partner_status_reply", "Partner status reply"]] },
  { title: "Rider registration", fields: [["rider_registration_url", "Rider registration URL"], ["rider_registration_reply", "Rider website form reply"], ["rider_registration_keywords", "Rider reply keywords"], ["preset_rider_registration_start", "Rider website form start"], ["preset_rider_submitted", "Rider submitted"], ["preset_rider_pending_status", "Rider pending status"], ["preset_rider_pending_approved", "Rider pending approved"], ["preset_rider_approved_reply", "Rider approved reply"], ["preset_rider_status_reply", "Rider status reply"]] },
  { title: "Shared registration and follow-up", fields: [["preset_registration_submit_confirmation", "Registration submit confirmation"], ["preset_registration_confirmation_no", "Registration confirmation No / Executive contact"], ["preset_registration_continue", "Website form continuation"], ["preset_registration_continue_invalid", "Website form help"], ["preset_registration_cancelled", "Registration cancelled"], ["preset_member_registration_cancelled", "Member registration cancelled"], ["preset_role_registration_incomplete", "Website form incomplete"], ["preset_pre_registration_followup", "Pre-registration follow-up"], ["preset_crm_followup_due", "CRM follow-up due"], ["preset_lifecycle_registration_form_opened", "Lifecycle registration form opened"], ["preset_lifecycle_registration_form_submitted", "Lifecycle registration form submitted"], ["preset_lifecycle_registration_form_followup_started", "Lifecycle registration follow-up started"], ["preset_lifecycle_member_registration_completed", "Lifecycle member registration completed"], ["preset_lifecycle_member_activated", "Lifecycle member activated"], ["preset_lifecycle_partner_registration_submitted", "Lifecycle partner registration submitted"], ["preset_lifecycle_partner_activated", "Lifecycle partner activated"], ["preset_lifecycle_metho_move_booking_created", "Lifecycle METHO Move booking created"], ["preset_ai_local_fallback", "Local fallback reply"]] },
];

const posterPresets = [
  ["default_auto_reply", "Default auto reply poster"],
  ["customer_auto_reply", "Customer auto reply poster"],
  ["member_auto_reply", "Member auto reply poster"],
  ["partner_auto_reply", "Partner auto reply poster"],
  ["registration_welcome_message", "Registration welcome poster"],
  ["member_registration_reply", "Member registration poster"],
  ["partner_registration_reply", "Partner registration poster"],
  ["rider_registration_reply", "Rider registration poster"],
];

export default function WhatsAppAISettingsPage() {
  const { user } = useAuth();
  const isAdmin = ["super_admin", "company_admin", "admin"].includes(user?.role);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [posterBusy, setPosterBusy] = useState(false);
  const presetKeys = useMemo(() => presetGroups.flatMap((group) => group.fields.map(([key]) => key)), []);
  const posterKeys = useMemo(() => posterPresets.flatMap(([key]) => [`${key}_image_url`, `${key}_mode`]), []);

  useEffect(() => {
    if (!isAdmin) return;
    api.get("/admin/settings/whatsapp").then(({ data }) => setForm(data)).catch(() => toast.error("WhatsApp preset messages could not be loaded"));
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/app" replace />;
  if (!form) return <div className="p-6 text-sm text-slate-500">Loading WhatsApp preset messages...</div>;
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const clear = (key) => setForm((current) => ({ ...current, [key]: "" }));
  const save = async () => {
    setSaving(true);
    try {
      const payload = {};
      [...presetKeys, ...posterKeys].forEach((key) => { payload[key] = String(form[key] || "").trim(); });
      const { data } = await api.put("/admin/settings/whatsapp", payload);
      setForm(data);
      toast.success("WhatsApp preset messages saved");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "WhatsApp preset messages could not be saved");
    } finally { setSaving(false); }
  };
  const uploadPoster = async (key, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPosterBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await api.post("/admin/settings/whatsapp/poster", body, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((current) => ({ ...current, [`${key}_image_url`]: data.url, [`${key}_mode`]: "image" }));
      toast.success("Preset poster uploaded");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Preset poster could not be uploaded");
    } finally { setPosterBusy(false); event.target.value = ""; }
  };
  const deletePoster = async (key) => {
    const url = form?.[`${key}_image_url`];
    if (!url) return;
    setPosterBusy(true);
    try {
      await api.delete("/admin/settings/whatsapp/poster", { data: { url } });
      setForm((current) => ({ ...current, [`${key}_image_url`]: "", [`${key}_mode`]: "text" }));
      toast.success("Preset poster cleared");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Preset poster could not be cleared");
    } finally { setPosterBusy(false); }
  };

  return <div className="mx-auto max-w-6xl space-y-5">
    <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">METHO Business CRM</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-900"><Settings2 className="h-6 w-6" /> WhatsApp Preset Messages</h1><p className="mt-1 text-sm text-slate-600">Manage every WhatsApp preset reply used by the live preset-only flow.</p></div>
    <div className="space-y-5 border border-border bg-white p-5">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">Preset messages are stored in the existing WhatsApp settings configuration. Sensitive customer data is not shown here.</div>
      {presetGroups.map((group) => <section key={group.title} className="border-t border-border pt-4 first:border-t-0 first:pt-0"><h2 className="text-sm font-semibold text-emerald-950">{group.title}</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{group.fields.map(([key, label]) => <div key={key}><div className="flex items-center justify-between gap-2"><Label>{label}</Label><Button type="button" size="sm" variant="outline" onClick={() => clear(key)}><Trash2 className="mr-1 h-3.5 w-3.5" />Clear</Button></div><Textarea value={form[key] || ""} onChange={update(key)} rows={4} className="mt-1.5" /></div>)}</div></section>)}
      <section className="border-t border-border pt-4"><h2 className="text-sm font-semibold text-emerald-950">Preset Posters</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{posterPresets.map(([key, label]) => <div key={key} className="rounded border border-emerald-100 p-3"><div className="flex items-center justify-between gap-2"><Label>{label}</Label><select value={form[`${key}_mode`] || "text"} onChange={update(`${key}_mode`)} className="rounded border border-input px-2 py-1 text-xs"><option value="text">Text only</option><option value="image">Poster only</option></select></div><p className="mt-2 break-all text-xs text-slate-500">{form[`${key}_image_url`] || "No poster attached"}</p><div className="mt-3 flex flex-wrap gap-2"><label className="inline-flex cursor-pointer items-center rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-800"><Upload className="mr-1 h-3.5 w-3.5" />Attach poster<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => uploadPoster(key, event)} disabled={posterBusy} /></label>{form[`${key}_image_url`] ? <Button type="button" size="sm" variant="outline" onClick={() => deletePoster(key)} disabled={posterBusy}><Trash2 className="mr-1 h-3.5 w-3.5" />Clear poster</Button> : null}</div></div>)}</div></section>
      <div className="flex justify-end"><Button onClick={save} disabled={saving || posterBusy}><Save className="mr-2 h-4 w-4" />{saving ? "Saving..." : "Save preset messages"}</Button></div>
    </div>
  </div>;
}
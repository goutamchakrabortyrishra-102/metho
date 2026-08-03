import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Store, Send, CheckCircle2, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Logo } from "@/components/Logo";
import { INDIAN_STATES, isCompletePincode, normalizePincode } from "@/lib/indiaLocation";

const BUSINESS_TYPES = ["Shop", "Service"];

const DEFAULT_POLICY = {
  mission_statement: "To build a trusted, product-driven smart earning ecosystem that delivers fair and sustainable income opportunities for everyone.",
  vision_statement: "Our vision is to empower marginalized people, transform small businesses from local to global, and build sustainable financial freedom with a special focus on women.",
  rules_and_conditions:
    "1. All bonuses, commissions, and rewards are processed strictly according to the official system rules and eligibility criteria.\n" +
    "2. Any fake orders, forged documents, misuse, or fraudulent activity may lead to immediate account suspension or termination.\n" +
    "3. The company reserves the right to update policies, plans, and operational rules whenever required, with notice through official channels.",
  return_policy:
    "1. Return requests for defective, damaged, or incorrect products can be raised within 7 days of delivery.\n" +
    "2. Used, tampered, or physically damaged products are not eligible for return unless covered by an approved exception.\n" +
    "3. For approved returns, refund or replacement will be processed within the committed service timeline as per policy.",
  partner_agreement_policy:
    "Each Associate Partner will have an individually approved agreement percentage, and commission will be calculated strictly according to that approved rate.",
};

export default function PartnerRegisterPage() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    business_name: "", business_type: "Shop",
    contact_person: "", phone: "", dob: "", email: "", password: "", whatsapp_no: "",
    address: "", city: "", state: "", pincode: "",
    gst_no: "", upi_id: "", website: "", social_link: "",
    business_description: "", commission_percent_ask: "",
  });
  const [busy, setBusy] = useState(false);
  const [pincodeBusy, setPincodeBusy] = useState(false);
  const lastLookupPinRef = useRef("");
  const [done, setDone] = useState(null);
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const isService = form.business_type === "Service";

  useEffect(() => {
    api.get("/settings").then((r) => {
      const s = r.data || {};
      setPolicy({
        mission_statement: (s.mission_statement || "").trim() || DEFAULT_POLICY.mission_statement,
        vision_statement: (s.vision_statement || "").trim() || DEFAULT_POLICY.vision_statement,
        rules_and_conditions: (s.rules_and_conditions || "").trim() || DEFAULT_POLICY.rules_and_conditions,
        return_policy: (s.return_policy || "").trim() || DEFAULT_POLICY.return_policy,
        partner_agreement_policy: (s.partner_agreement_policy || "").trim() || DEFAULT_POLICY.partner_agreement_policy,
      });
    }).catch(() => {});
  }, []);

  const upd = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  useEffect(() => {
    const pin = normalizePincode(form.pincode);
    if (!isCompletePincode(pin)) return;
    if (lastLookupPinRef.current === pin) return;

    let cancelled = false;
    setPincodeBusy(true);
    api
      .get(`/directory/pincode-lookup?pincode=${encodeURIComponent(pin)}`)
      .then((r) => {
        if (cancelled) return;
        const city = String(r?.data?.city || "").trim();
        const state = String(r?.data?.state || "").trim();
        setForm((prev) => ({
          ...prev,
          pincode: pin,
          city: city || prev.city,
          state: state || prev.state,
        }));
        lastLookupPinRef.current = pin;
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("Pincode থেকে city খুঁজে পাওয়া যায়নি");
        }
      })
      .finally(() => {
        if (!cancelled) setPincodeBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [form.pincode]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.business_name || !form.contact_person || !form.phone || !form.email || !form.password || !form.address || !form.city || !form.state) {
      return toast.error("Please fill all required fields");
    }
    if (String(form.password || "").length < 6) {
      return toast.error("Password must be at least 6 characters");
    }
    setBusy(true);
    try {
      const payload = { ...form };
      if (payload.commission_percent_ask === "") delete payload.commission_percent_ask;
      else payload.commission_percent_ask = Number(payload.commission_percent_ask);
      const { data } = await api.post("/partners/register", payload);
      setDone(data);
      toast.success("Application submitted!");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Submission failed");
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl border-2 border-emerald-300 p-8 text-center shadow-xl" data-testid="partner-register-success">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 className="w-9 h-9 text-emerald-700" />
          </div>
          <h1 className="mt-4 font-display font-black text-2xl text-emerald-950">Application Received!</h1>
          <p className="mt-3 text-slate-600 font-body text-sm">{done.message}</p>
          <p className="mt-4 text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-3 font-mono text-emerald-800">
            Reference ID: {done.request_id?.slice(0, 8)}
          </p>
          <p className="mt-4 text-xs text-slate-500 font-body">
            Once approved by admin, sign in using the username and password you set in this form.
          </p>
          <Link to="/" className="mt-6 inline-block">
            <Button className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full">Back to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50" data-testid="partner-register-page">
      <header className="bg-emerald-950 text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Logo />
          <Link to="/directory" className="text-sm text-white/80 hover:text-amber-400 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Explore Partners
          </Link>
        </div>
      </header>

      <div className="bg-gradient-to-br from-emerald-950 to-emerald-800 text-white">
        <div className="max-w-4xl mx-auto px-4 py-10 md:py-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-xs font-semibold">
            <Store className="w-3.5 h-3.5" /> Become a METHO Associate Partner
          </div>
          <h1 className="mt-4 font-display font-black text-3xl md:text-5xl leading-tight tracking-tight">
            Register your <span className="text-amber-400">Shop or Service</span> with METHO
          </h1>
          <p className="mt-3 text-emerald-100/85 font-body max-w-2xl">
            Choose only one sector: Shop or Service.
            One mobile number and one PAN/GST/business ID can be used for only one partner registration.
            After admin approval, your partner login activates with your chosen username and password.
          </p>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <form onSubmit={submit} className="bg-white rounded-2xl border border-border p-6 md:p-8 space-y-6" data-testid="partner-register-form">

          <section>
            <h2 className="font-display font-black text-lg text-emerald-950">Business Details</h2>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div className="md:col-span-2">
                <Label>{isService ? "Service Name *" : "Shop Name *"}</Label>
                <Input required value={form.business_name} onChange={upd("business_name")} placeholder={isService ? "e.g. City Care Diagnostics" : "e.g. Sharma Kirana Store"} className="mt-1.5 h-11" data-testid="reg-business-name" />
              </div>
              <div>
                <Label>Sector *</Label>
                <select required value={form.business_type} onChange={upd("business_type")} className="mt-1.5 h-11 w-full rounded-md border border-input bg-white px-3 text-sm" data-testid="reg-business-type">
                  {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <Label>PAN / GST / Business ID (optional)</Label>
                <Input value={form.gst_no} onChange={upd("gst_no")} placeholder="PAN, GST or other business ID" maxLength={30} className="mt-1.5 h-11 font-mono uppercase" data-testid="reg-gst" />
                <p className="text-[11px] text-muted-foreground mt-1">If provided, this ID can be used for only one Shop or Service registration.</p>
              </div>
              <div className="md:col-span-2">
                <Label>{isService ? "Service Description (optional)" : "Shop Description (optional)"}</Label>
                <Textarea rows={3} value={form.business_description} onChange={upd("business_description")} placeholder={isService ? "Briefly describe your service, slots or specialties..." : "Briefly describe your shop and available items..."} className="mt-1.5" data-testid="reg-description" />
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-display font-black text-lg text-emerald-950">Contact Person</h2>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div>
                <Label>{isService ? "Owner / Service Manager Name *" : "Owner / Shop Manager Name *"}</Label>
                <Input required value={form.contact_person} onChange={upd("contact_person")} placeholder="Full name" className="mt-1.5 h-11" data-testid="reg-contact-name" />
              </div>
              <div>
                <Label>Phone *</Label>
                <Input required type="tel" value={form.phone} onChange={upd("phone")} placeholder="+91..." className="mt-1.5 h-11" data-testid="reg-phone" />
              </div>
              <div>
                <Label>Date of Birth <span className="text-xs text-muted-foreground">(Optional)</span></Label>
                <Input type="date" value={form.dob} onChange={upd("dob")} className="mt-1.5 h-11" data-testid="reg-dob" />
              </div>
              <div>
                <Label>Username *</Label>
                <Input required type="text" value={form.email} onChange={upd("email")} placeholder="Choose your partner username" className="mt-1.5 h-11" data-testid="reg-email" />
                <p className="text-[11px] text-muted-foreground mt-1">This will be your partner username after approval.</p>
              </div>
              <div>
                <Label>Password *</Label>
                <Input required type="password" minLength={6} value={form.password} onChange={upd("password")} placeholder="Minimum 6 characters" className="mt-1.5 h-11" data-testid="reg-password" />
              </div>
              <div>
                <Label>WhatsApp No (if different)</Label>
                <Input type="tel" value={form.whatsapp_no} onChange={upd("whatsapp_no")} placeholder="+91... (blank = same as phone)" className="mt-1.5 h-11" data-testid="reg-whatsapp" />
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-display font-black text-lg text-emerald-950">Location</h2>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div className="md:col-span-2">
                <Label>Address *</Label>
                <Textarea required rows={2} value={form.address} onChange={upd("address")} placeholder="Shop no, street, area" className="mt-1.5" data-testid="reg-address" />
              </div>
              <div>
                <Label>City *</Label>
                <Input required value={form.city} onChange={upd("city")} placeholder="Kolkata" className="mt-1.5 h-11" data-testid="reg-city" />
              </div>
              <div>
                <Label>State *</Label>
                <Input required list="state-options-register" value={form.state} onChange={upd("state")} placeholder="Select or type state" className="mt-1.5 h-11" data-testid="reg-state" />
                <datalist id="state-options-register">
                  {INDIAN_STATES.map((state) => <option key={state} value={state} />)}
                </datalist>
              </div>
              <div>
                <Label>Pincode</Label>
                <Input
                  value={form.pincode}
                  onChange={(e) => setForm((prev) => ({ ...prev, pincode: normalizePincode(e.target.value) }))}
                  placeholder="700001"
                  maxLength={6}
                  className="mt-1.5 h-11 font-mono"
                  data-testid="reg-pincode"
                />
                {pincodeBusy ? <p className="text-[11px] text-muted-foreground mt-1">Pincode থেকে city আনা হচ্ছে...</p> : null}
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-display font-black text-lg text-emerald-950">Payment & Web Presence (optional)</h2>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div>
                <Label>UPI ID</Label>
                <Input value={form.upi_id} onChange={upd("upi_id")} placeholder="business@paytm" className="mt-1.5 h-11 font-mono" data-testid="reg-upi" />
              </div>
              <div>
                <Label>Preferred Commission %</Label>
                <Input type="number" min={1} max={50} step="0.5" value={form.commission_percent_ask} onChange={upd("commission_percent_ask")} placeholder="e.g. 10" className="mt-1.5 h-11" data-testid="reg-commission" />
                <p className="text-[11px] text-muted-foreground mt-1">Final commission is decided by admin.</p>
              </div>
              <div>
                <Label>Website</Label>
                <Input value={form.website} onChange={upd("website")} placeholder="https://" className="mt-1.5 h-11" data-testid="reg-website" />
              </div>
              <div>
                <Label>Social Link</Label>
                <Input value={form.social_link} onChange={upd("social_link")} placeholder="Instagram / Facebook URL" className="mt-1.5 h-11" data-testid="reg-social" />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 md:p-5" data-testid="partner-policy-section">
            <h2 className="font-display font-black text-lg text-emerald-950">Mission, Vision & Policies</h2>
            <p className="text-xs text-emerald-900/80 mt-1">Please review these before submitting your partner application.</p>

            <div className="mt-4 space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-emerald-900 font-semibold">Mission Statement</p>
                <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{policy.mission_statement}</p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wider text-emerald-900 font-semibold">Vision Statement</p>
                <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{policy.vision_statement}</p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wider text-emerald-900 font-semibold">Terms & Conditions</p>
                <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{policy.rules_and_conditions}</p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wider text-emerald-900 font-semibold">Return Policy</p>
                <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{policy.return_policy}</p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wider text-emerald-900 font-semibold">Partner Agreement Policy</p>
                <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{policy.partner_agreement_policy}</p>
              </div>
            </div>
          </section>

          <div className="border-t border-border pt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground font-body max-w-md">
              By submitting, you agree to the Partner Agreement Policy above. Your Shop or Service appears in directory only after admin approval.
            </p>
            <Button type="submit" disabled={busy} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-8 h-12" data-testid="reg-submit">
              {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</> : <><Send className="w-4 h-4 mr-2" /> Submit Application</>}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}


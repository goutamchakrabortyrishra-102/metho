import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Loader2, Gift, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import api from "@/services/api";

const DEFAULT_POLICY = {
  rules_and_conditions:
    "1. Bonuses, commissions, and rewards are processed only as per official system rules and eligibility criteria.\n" +
    "2. Fake orders, document forgery, misuse, or any fraudulent activity may result in immediate account suspension or termination.\n" +
    "3. The company may update policies, plans, and operational rules with notice through official channels.",
};

const DEFAULT_METHO_ADMIN_SPONSOR_ID = "MAU00001";

const generateMemberId = () => {
  const randomFiveDigits = Math.floor(10000 + Math.random() * 90000);
  return `MAU${randomFiveDigits}`;
};

export default function RegisterPage() {
  const [params] = useSearchParams();
  const refFromUrl = (params.get("ref") || "").trim().toUpperCase();
  const [form, setForm] = useState(() => ({
    name: "",
    email: generateMemberId(),
    phone: "",
    dob: "",
    address: "",
    pan_no: "",
    password: "",
    sponsor_code: refFromUrl || DEFAULT_METHO_ADMIN_SPONSOR_ID,
  }));
  const [loading, setLoading] = useState(false);
  const [sponsorInfo, setSponsorInfo] = useState(null);
  const [signupBonus, setSignupBonus] = useState(0);
  const [smartCycleBonus, setSmartCycleBonus] = useState(10);
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const { register, login, logout } = useAuth();
  const nav = useNavigate();

  // On mount: pull signup bonus + smart cycle % + resolve sponsor code (either from URL or manual entry)
  useEffect(() => {
    api.get("/settings").then((r) => {
      const s = r.data || {};
      setSignupBonus(Number(s.referral_signup_bonus) || 0);
      setSmartCycleBonus(Number(s.smart_cycle_bonus_percent) || 10);
      setPolicy({
        rules_and_conditions: (s.rules_and_conditions || "").trim() || DEFAULT_POLICY.rules_and_conditions,
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const code = (form.sponsor_code || "").trim().toUpperCase();
    if (!code) { setSponsorInfo(null); return; }
    const t = setTimeout(() => {
      api.get(`/auth/sponsor-info/${encodeURIComponent(code)}`)
        .then((r) => setSponsorInfo(r.data))
        .catch(() => setSponsorInfo({ error: true, member_code: code }));
    }, 300);
    return () => clearTimeout(t);
  }, [form.sponsor_code]);

  useEffect(() => {
    if (refFromUrl) {
      try {
        localStorage.setItem("metho_ref_code", refFromUrl);
      } catch {}
      setForm((f) => ({ ...f, sponsor_code: refFromUrl }));
      return;
    }
    setForm((f) => ({ ...f, sponsor_code: DEFAULT_METHO_ADMIN_SPONSOR_ID }));
  }, [refFromUrl]);

  const setField = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const normalizePhone = (raw) => String(raw || "").replace(/[^\d]/g, "");

  const isValidPhone = (raw) => {
    const digits = normalizePhone(raw);
    return digits.length >= 10 && digits.length <= 15;
  };

  const isValidPan = (raw) => /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(String(raw || "").trim().toUpperCase());

  const getErrorMessage = (err) => {
    if (err?.code === "ERR_NETWORK" || !err?.response) {
      return "Server temporarily unreachable. Please try again in a moment.";
    }
    const detail = err?.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (typeof first === "string" && first.trim()) return first;
      if (first?.msg) return String(first.msg);
    }
    if (detail && typeof detail === "object") {
      if (typeof detail.message === "string" && detail.message.trim()) return detail.message;
      if (typeof detail.msg === "string" && detail.msg.trim()) return detail.msg;
    }
    const status = Number(err?.response?.status || 0);
    if (status >= 500) return "Server error during registration. Please try again in a moment.";
    if (typeof err?.message === "string" && err.message.trim()) return err.message;
    return "Registration failed";
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!agreedToTerms) {
      return toast.error("Please accept Terms & Conditions to continue");
    }

    const memberId = String(form.email || "").trim();
    if (!memberId) {
      return toast.error("Member ID is required");
    }

    const sponsorCodeInput = String(form.sponsor_code || "").trim().toUpperCase();
    if (!sponsorCodeInput) {
      return toast.error("Sponsor ID is required");
    }

    if (sponsorInfo?.error && sponsorCodeInput && sponsorCodeInput !== DEFAULT_METHO_ADMIN_SPONSOR_ID) {
      return toast.error("Sponsor code not found. Please correct it or clear it.");
    }

    if (!isValidPhone(form.phone)) {
      return toast.error("Please enter a valid phone number (10 to 15 digits)");
    }

    if (!isValidPan(form.pan_no)) {
      return toast.error("PAN must be in format: ABCDE1234F");
    }

    if (!String(form.dob || "").trim()) {
      return toast.error("Date of birth is required");
    }

    let submittedMemberId = String(form.email || "").trim().toUpperCase();
    const submittedPassword = String(form.password || "");

    setLoading(true);
    try {
      // Read directly from form to avoid browser autofill/state desync issues.
      const formData = new FormData(e.currentTarget);
      const payload = {
        name: String(formData.get("name") ?? form.name).trim(),
        email: submittedMemberId,
        username: submittedMemberId,
        member_id: submittedMemberId,
        member_code: submittedMemberId,
        phone: normalizePhone(String(formData.get("phone") ?? form.phone).trim()),
        pan_no: String(formData.get("pan_no") ?? form.pan_no).trim().toUpperCase(),
        password: String(formData.get("password") ?? form.password),
        needs_admin_approval: true,
      };

      const dobValue = String(formData.get("dob") ?? form.dob).trim();
      if (dobValue) payload.dob = dobValue;

      const sponsorCode = String(formData.get("sponsor_code") ?? form.sponsor_code).trim().toUpperCase() || DEFAULT_METHO_ADMIN_SPONSOR_ID;
      payload.sponsor_code = sponsorCode;

      const addressValue = String(formData.get("address") ?? form.address).trim();
      if (addressValue) payload.address = addressValue;

      let result;
      let lastRegistrationError = null;
      const MAX_MEMBER_ID_RETRIES = 6;
      for (let attempt = 0; attempt < MAX_MEMBER_ID_RETRIES; attempt += 1) {
        try {
          result = await register(payload);
          lastRegistrationError = null;
          break;
        } catch (attemptErr) {
          const msg = getErrorMessage(attemptErr);
          const lower = String(msg || "").toLowerCase();
          const isUsernameDuplicate = lower.includes("username already registered");
          if (!isUsernameDuplicate) {
            throw attemptErr;
          }
          lastRegistrationError = attemptErr;
          submittedMemberId = generateMemberId();
          setForm((f) => ({ ...f, email: submittedMemberId }));
          payload.email = submittedMemberId;
          payload.username = submittedMemberId;
          payload.member_id = submittedMemberId;
          payload.member_code = submittedMemberId;
        }
      }
      if (lastRegistrationError) {
        throw lastRegistrationError;
      }

      if (result?.token || result?.user) logout();

      if (result?.registration_exists) {
        toast.success(`Registration already submitted. Member ID: ${submittedMemberId}. Please wait for admin approval.`);
        nav("/login");
      } else {
        toast.success(`Registration submitted. Member ID: ${submittedMemberId}. Please wait for admin approval.`);
        nav("/login");
      }
    } catch (err) {
      const msg = getErrorMessage(err);
      const m = String(msg || "").toLowerCase();
      if (m.includes("username already registered")) {
        // If backend partially created the account earlier, treat it as submitted.
        try {
          await login(submittedMemberId, submittedPassword, { adminMode: false });
          logout();
          toast.success(`Registration already submitted for Member ID: ${submittedMemberId}. Please wait for admin approval.`);
          nav("/login");
          return;
        } catch (loginErr) {
          const lm = String(loginErr?.response?.data?.detail || loginErr?.message || "").toLowerCase();
          if (lm.includes("not active yet") || lm.includes("first approved purchase")) {
            toast.success(`Registration submitted for Member ID: ${submittedMemberId}. Please wait for admin approval.`);
            nav("/login");
            return;
          }
        }
        toast.error("Auto-generated member ID collided multiple times. Please retry registration.");
      } else if (m.includes("phone") && m.includes("already")) {
        toast.error("This phone number is already registered. Use a different phone number.");
      } else if (m.includes("pan") && m.includes("already")) {
        toast.error("This PAN is already registered. Use a different PAN number.");
      } else if (m.includes("date of birth is required")) {
        toast.error("Date of birth is currently required by server. Please select DOB and try again.");
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2" data-testid="register-page">
      <div className="flex items-center justify-center p-8 md:p-16 bg-background order-2 md:order-1">
        <form onSubmit={submit} className="w-full max-w-md space-y-5" data-testid="register-form">
          <div className="md:hidden"><Logo /></div>
          <div>
            <h2 className="font-display font-black text-3xl text-emerald-950 tracking-tight">Create Account</h2>
            <p className="text-sm text-muted-foreground mt-1 font-body">Join thousands of METHO Partners today</p>
          </div>

          {/* Perk strip — always visible, drives conversion */}
          <div className="flex flex-wrap gap-2" data-testid="register-perks">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-900 px-2.5 py-1 rounded-full">
              <Sparkles className="w-3 h-3" /> Free lifetime
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-900 px-2.5 py-1 rounded-full">
              <Gift className="w-3 h-3" /> First order · {smartCycleBonus}% Smart Cycle back
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-900 px-2.5 py-1 rounded-full">
              <CheckCircle2 className="w-3 h-3" /> Wallet active Day 1
            </span>
          </div>

          {sponsorInfo && !sponsorInfo.error && (
            <div className="rounded-xl bg-gradient-to-r from-amber-50 to-emerald-50 border border-amber-300 p-4 flex items-start gap-3" data-testid="sponsor-confirm-card">
              <div className="w-10 h-10 rounded-full bg-emerald-900 text-amber-400 flex items-center justify-center font-display font-black shrink-0">
                {(sponsorInfo.name || "?").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-bold">Referred by</p>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                </div>
                <p className="font-display font-bold text-emerald-950 truncate">{sponsorInfo.name}</p>
                <div className="flex items-center gap-2 mt-0.5 text-xs">
                  <span className="font-mono text-emerald-800 bg-white/70 px-1.5 py-0.5 rounded">{sponsorInfo.member_code}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-emerald-800 font-semibold">{sponsorInfo.rank}</span>
                </div>
                {signupBonus > 0 && (
                  <p className="text-[11px] text-emerald-900 mt-2 font-body">
                    <Gift className="w-3 h-3 inline mr-1 text-amber-600" />
                    Your sponsor earns <span className="font-bold">₹{signupBonus}</span> instant signup bonus when you register.
                  </p>
                )}
              </div>
            </div>
          )}
          {sponsorInfo?.error && form.sponsor_code && form.sponsor_code !== DEFAULT_METHO_ADMIN_SPONSOR_ID && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2" data-testid="sponsor-invalid-card">
              <AlertCircle className="w-4 h-4 text-red-700 mt-0.5 shrink-0" />
              <div className="text-xs text-red-800">
                Sponsor code <span className="font-mono font-bold">{sponsorInfo.member_code}</span> not found. Please double-check with your referrer.
              </div>
            </div>
          )}
          <div className="space-y-3">
            <div>
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" name="name" required value={form.name} onChange={setField("name")} placeholder="" data-testid="register-name-input" className="mt-1.5 h-11" />
            </div>
            <div>
              <Label htmlFor="email">Member ID <span className="text-red-600">*</span></Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input id="email" name="email" required readOnly value={form.email} placeholder="Auto generated member ID" data-testid="register-email-input" className="h-11 font-mono bg-emerald-50 border-emerald-300" />
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, email: generateMemberId() }))}
                  className="h-11 px-3 rounded-md border border-emerald-300 text-emerald-900 text-xs font-semibold whitespace-nowrap hover:bg-emerald-50"
                >
                  Regenerate
                </button>
              </div>
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" required value={form.phone} onChange={setField("phone")} placeholder="10-15 digit phone number" data-testid="register-phone-input" className="mt-1.5 h-11" />
            </div>
            <div>
              <Label htmlFor="dob">Date of Birth <span className="text-red-600">*</span></Label>
              <Input id="dob" name="dob" type="date" required value={form.dob} onChange={setField("dob")} data-testid="register-dob-input" className="mt-1.5 h-11" />
            </div>
            <div>
              <Label htmlFor="address">Address <span className="text-xs text-muted-foreground">(Optional)</span></Label>
              <Input id="address" name="address" value={form.address} onChange={setField("address")} placeholder="Village/City/State" data-testid="register-address-input" className="mt-1.5 h-11" />
            </div>
            <div>
              <Label htmlFor="pan_no">PAN Number <span className="text-red-600">*</span></Label>
              <Input id="pan_no" name="pan_no" required value={form.pan_no} onChange={setField("pan_no")} placeholder="ABCDE1234F" data-testid="register-pan-input" className="mt-1.5 h-11 uppercase" maxLength={10} />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required minLength={6} value={form.password} onChange={setField("password")} placeholder="Minimum 6 characters" data-testid="register-password-input" className="mt-1.5 h-11" />
            </div>
            <div>
              <Label htmlFor="sponsor_code" className="flex items-center gap-1.5">
                Sponsor ID <span className="text-red-600">*</span>
                {refFromUrl && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full">
                    <Gift className="w-3 h-3" /> Referred
                  </span>
                )}
              </Label>
              <Input
                id="sponsor_code"
                name="sponsor_code"
                required
                value={form.sponsor_code}
                onChange={setField("sponsor_code")}
                placeholder="Default sponsor ID (you can change)"
                data-testid="register-sponsor-input"
                className={"mt-1.5 h-11 " + (refFromUrl ? "bg-amber-50 border-amber-300" : "")}
              />
              {!refFromUrl && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Sponsor ID is prefilled by default. You can replace it before submit.
                </p>
              )}
            </div>
          </div>

          <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4" data-testid="member-terms-section">
            <h3 className="font-display font-black text-lg text-emerald-950">Terms & Conditions</h3>
            <p className="text-xs text-emerald-900/80 mt-1">Please review and accept before creating your member account.</p>

            <div className="mt-4 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-emerald-900 font-semibold">Terms & Conditions</p>
                <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{policy.rules_and_conditions}</p>
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer" data-testid="register-terms-checkbox-wrap">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-emerald-400"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  data-testid="register-terms-checkbox"
                />
                <span>I have read and agree to the Terms & Conditions.</span>
              </label>
            </div>
          </section>

          <Button type="submit" disabled={loading || !agreedToTerms} className="w-full h-12 bg-emerald-900 hover:bg-emerald-950 text-white rounded-full font-semibold" data-testid="register-submit-button">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Create Account <ArrowRight className="ml-2 w-4 h-4" /></>}
          </Button>
          <p className="text-center text-sm text-muted-foreground font-body">
            Already registered? <Link to="/login" className="text-emerald-900 font-semibold hover:underline" data-testid="register-to-login-link">Sign in</Link>
          </p>
        </form>
      </div>

      <div className="hidden md:flex bg-gradient-to-br from-emerald-950 to-emerald-800 text-white p-12 flex-col justify-between relative overflow-hidden order-1 md:order-2">
        <div className="absolute inset-0 grain opacity-30" />
        <Logo />
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.25em] text-amber-400 font-semibold">Get Started</p>
          <h1 className="mt-4 font-display font-black text-5xl leading-none tracking-tight">
            Your income<br /><span className="text-amber-400 italic">journey starts here.</span>
          </h1>
          <ul className="mt-6 space-y-3 max-w-sm font-body">
            {["Free lifetime membership", "Instant wallet activation", "Real-time reward distribution from Day 1", "Genealogy tree access"].map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-emerald-100/90 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-emerald-100/50 relative">© 2026 Metho Logistics Private Limited</p>
      </div>
    </div>
  );
}


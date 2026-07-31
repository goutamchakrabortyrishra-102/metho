import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { User, Shield, CheckCircle2, KeyRound, Eye, EyeOff } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resolveAssetUrl } from "@/lib/utils";

export default function ProfilePage() {
  const { user } = useAuth();
  const [kyc, setKyc] = useState(null);
  const [form, setForm] = useState({ nid_number: "", address: "", date_of_birth: "" });
  const [payout, setPayout] = useState({
    bank_account_holder: "",
    bank_name: "",
    bank_branch: "",
    bank_account_number: "",
    bank_ifsc: "",
    upi_id: "",
    upi_qr_url: "",
  });
  const [savingPayout, setSavingPayout] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get("/kyc/me").then(r => setKyc(r.data));
    api.get("/auth/payout-details").then(r => setPayout({ ...payout, ...r.data })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submitKyc = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await api.post("/kyc/submit", form);
      toast.success("KYC submitted for review!");
      setKyc(r.data.kyc);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "KYC submission failed");
    } finally {
      setLoading(false);
    }
  };

  const setP = (k) => (e) => setPayout((prev) => ({ ...prev, [k]: e.target.value }));

  const savePayout = async (e) => {
    e.preventDefault();
    setSavingPayout(true);
    try {
      const payload = {
        ...payout,
        bank_ifsc: (payout.bank_ifsc || "").toUpperCase(),
      };
      const { data } = await api.put("/auth/payout-details", payload);
      setPayout((prev) => ({ ...prev, ...data }));
      toast.success("Bank / UPI details saved");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally {
      setSavingPayout(false);
    }
  };

  const uploadQr = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadingQr(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/upload/upi-qr", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPayout((prev) => ({ ...prev, upi_qr_url: data.url }));
      toast.success("UPI QR uploaded");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "QR upload failed");
    } finally {
      setUploadingQr(false);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-6" data-testid="profile-page">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Profile</p>
        <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Your Account</h1>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 bg-white rounded-xl border border-border p-6 text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-900 text-amber-400 flex items-center justify-center font-display font-black text-3xl mx-auto">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <h3 className="font-display font-bold text-emerald-950 mt-4">{user?.name}</h3>
          <p className="text-sm text-muted-foreground font-body">{user?.email}</p>
          <p className="text-xs text-slate-500 mt-1 font-mono">{user?.member_code}</p>
          <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 gap-2 text-left">
            <div>
              <p className="text-[10px] uppercase text-slate-500 tracking-wider">Role</p>
              <p className="font-semibold text-emerald-950 text-sm capitalize">{user?.role?.replace("_", " ")}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500 tracking-wider">Rank</p>
              <p className="font-semibold text-emerald-950 text-sm">{user?.rank}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500 tracking-wider">Phone</p>
              <p className="font-semibold text-emerald-950 text-sm">{user?.phone}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500 tracking-wider">Sponsor</p>
              <p className="font-semibold text-emerald-950 text-sm">{user?.sponsor_code || "—"}</p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl border border-border p-6">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-emerald-800" />
            <div>
              <h3 className="font-display font-bold text-emerald-950">KYC Verification</h3>
              <p className="text-xs text-muted-foreground font-body">Complete your NID verification to unlock all features</p>
            </div>
            <span className={`ml-auto text-xs font-semibold px-2 py-1 rounded-full ${
              kyc?.status === "approved" ? "bg-emerald-100 text-emerald-800" :
              kyc?.status === "pending" ? "bg-amber-100 text-amber-800" :
              "bg-slate-100 text-slate-700"
            }`} data-testid="kyc-status-badge">{kyc?.status || "not_submitted"}</span>
          </div>

          {kyc?.status === "approved" ? (
            <div className="mt-6 flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <CheckCircle2 className="w-6 h-6 text-emerald-700" />
              <div>
                <p className="font-display font-bold text-emerald-900">KYC Verified</p>
                <p className="text-sm text-emerald-800/80 font-body">All features unlocked. Happy earning!</p>
              </div>
            </div>
          ) : (
            <form onSubmit={submitKyc} className="mt-6 space-y-4" data-testid="kyc-form">
              <div>
                <Label>NID Number</Label>
                <Input required value={form.nid_number} onChange={setF("nid_number")} placeholder="13 or 17 digit NID" data-testid="kyc-nid-input" />
              </div>
              <div>
                <Label>Date of Birth</Label>
                <Input required type="date" value={form.date_of_birth} onChange={setF("date_of_birth")} data-testid="kyc-dob-input" />
              </div>
              <div>
                <Label>Full Address</Label>
                <Textarea required value={form.address} onChange={setF("address")} placeholder="Village, Thana, District, Post Code" data-testid="kyc-address-input" />
              </div>
              <Button type="submit" disabled={loading} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-6" data-testid="kyc-submit-button">
                {loading ? "Submitting..." : "Submit for Verification"}
              </Button>
            </form>
          )}
        </div>
      </div>

      <form onSubmit={savePayout} className="bg-white rounded-2xl border border-border p-6 space-y-4" data-testid="payout-details-card">
        <div>
          <h2 className="font-display font-black text-xl text-emerald-950">Member Bank / UPI Details</h2>
          <p className="text-xs text-muted-foreground font-body mt-0.5">Withdrawal-এর জন্য আপনার bank/UPI details save করুন।</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900" data-testid="member-otp-safety-notice">
          <p className="font-semibold">মেঠো পলিসি: আমরা কখনো OTP/UPI PIN/ATM PIN/CVV চাই না। কেউ মেঠো নামে চাইলে শেয়ার করবেন না।</p>
          <p className="mt-1">METHO policy: we never ask for OTP/UPI PIN/ATM PIN/CVV. Do not share if anyone asks in METHO's name.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label>Account Holder Name</Label>
            <Input value={payout.bank_account_holder} onChange={setP("bank_account_holder")} className="mt-1.5" data-testid="payout-holder" />
          </div>
          <div>
            <Label>Bank Name</Label>
            <Input value={payout.bank_name} onChange={setP("bank_name")} className="mt-1.5" data-testid="payout-bank" />
          </div>
          <div>
            <Label>Branch</Label>
            <Input value={payout.bank_branch} onChange={setP("bank_branch")} className="mt-1.5" data-testid="payout-branch" />
          </div>
          <div>
            <Label>Account Number</Label>
            <Input value={payout.bank_account_number} onChange={setP("bank_account_number")} className="mt-1.5" data-testid="payout-account-no" />
          </div>
          <div>
            <Label>IFSC</Label>
            <Input value={payout.bank_ifsc} onChange={setP("bank_ifsc")} className="mt-1.5 uppercase" data-testid="payout-ifsc" />
          </div>
          <div>
            <Label>UPI ID</Label>
            <Input value={payout.upi_id} onChange={setP("upi_id")} className="mt-1.5" placeholder="name@bank" data-testid="payout-upi-id" />
          </div>
          <div className="md:col-span-2">
            <Label>UPI QR</Label>
            <div className="mt-1.5 flex items-center gap-3">
              {payout.upi_qr_url ? (
                <img src={resolveAssetUrl(payout.upi_qr_url)} alt="UPI QR" className="h-20 w-20 object-contain border border-border rounded-md p-1 bg-white" />
              ) : (
                <div className="h-20 w-20 rounded-md border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 text-xs">No QR</div>
              )}
              <div className="flex items-center gap-2">
                <input type="file" accept="image/*" onChange={uploadQr} data-testid="payout-upi-qr-upload" />
                {uploadingQr ? <span className="text-xs text-slate-500">Uploading...</span> : null}
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={savingPayout} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-6" data-testid="payout-save-btn">
            {savingPayout ? "Saving..." : "Save Bank / UPI Details"}
          </Button>
        </div>
      </form>

      <ChangePasswordCard />
    </div>
  );
}

function ChangePasswordCard() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCur, setShowCur] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next.length < 6) return toast.error("New password must be at least 6 characters");
    if (next !== confirm) return toast.error("New password and confirmation don't match");
    setBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: cur, new_password: next });
      toast.success("Password changed successfully. Use the new password from next login.");
      setCur(""); setNext(""); setConfirm("");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Password change failed");
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-border p-6 space-y-4" data-testid="change-password-card">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center"><KeyRound className="w-5 h-5 text-emerald-800" /></div>
        <div>
          <h2 className="font-display font-black text-xl text-emerald-950">Change Password</h2>
          <p className="text-xs text-muted-foreground font-body">নিরাপত্তার জন্য নিয়মিত পাসওয়ার্ড পরিবর্তন করুন।</p>
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <Label>Current Password</Label>
          <div className="relative mt-1.5">
            <Input required type={showCur ? "text" : "password"} value={cur} onChange={(e) => setCur(e.target.value)} data-testid="cp-current" className="h-11 pr-10" />
            <button type="button" onClick={() => setShowCur(!showCur)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">{showCur ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
          </div>
        </div>
        <div>
          <Label>New Password</Label>
          <div className="relative mt-1.5">
            <Input required type={showNext ? "text" : "password"} value={next} onChange={(e) => setNext(e.target.value)} data-testid="cp-new" className="h-11 pr-10" minLength={6} />
            <button type="button" onClick={() => setShowNext(!showNext)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">{showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Minimum 6 characters</p>
        </div>
        <div>
          <Label>Confirm New Password</Label>
          <Input required type={showNext ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="cp-confirm" className="mt-1.5 h-11" minLength={6} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-6" data-testid="cp-submit">
          {busy ? "Updating..." : "Update Password"}
        </Button>
      </div>
    </form>
  );
}


import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import api from "@/services/api";

export default function RiderRegisterPage() {
  const [loading, setLoading] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const nav = useNavigate();

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      await api.post("/rider/register", { ...Object.fromEntries(form.entries()), agreed_to_terms: agreedToTerms });
      toast.success("Registration submitted. Please wait for admin approval.");
      nav("/login?role=rider");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Rider registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/30 p-6">
      <form onSubmit={submit} className="w-full max-w-lg space-y-5 rounded-xl bg-white p-8 shadow-sm" data-testid="rider-register-form">
        <Logo />
        <div>
          <h1 className="font-display font-black text-3xl text-emerald-950">Rider Registration</h1>
          <p className="mt-1 text-sm text-muted-foreground">Submit your details for admin approval.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="rider-name">Name</Label><Input id="rider-name" name="name" required className="mt-1.5" /></div>
          <div><Label htmlFor="rider-phone">Phone</Label><Input id="rider-phone" name="phone" required className="mt-1.5" /></div>
          <div><Label htmlFor="rider-email">Email</Label><Input id="rider-email" name="email" type="email" required className="mt-1.5" /></div>
          <div><Label htmlFor="rider-password">Password</Label><Input id="rider-password" name="password" type="password" minLength={6} required className="mt-1.5" /></div>
          <div><Label htmlFor="rider-whatsapp">WhatsApp</Label><Input id="rider-whatsapp" name="whatsapp" className="mt-1.5" /></div>
          <div><Label htmlFor="rider-vehicle-type">METHO service category</Label><select id="rider-vehicle-type" name="vehicle_type" required defaultValue="ebike" className="mt-1.5 h-10 w-full rounded-md border border-input bg-white px-3 text-sm"><option value="ebike">E-bike</option><option value="e_rickshaw">E-rickshaw</option><option value="auto_rickshaw">Auto-rickshaw</option><option value="delivery">METHO Delivery</option></select></div>
          <div><Label htmlFor="rider-vehicle-number">Vehicle number</Label><Input id="rider-vehicle-number" name="vehicle_number" required className="mt-1.5" /></div>
          <div className="sm:col-span-2"><Label htmlFor="rider-address">Address</Label><Input id="rider-address" name="address" required className="mt-1.5" /></div>
          <div><Label htmlFor="rider-city">City</Label><Input id="rider-city" name="city" required className="mt-1.5" /></div>
          <div><Label htmlFor="rider-district">District</Label><Input id="rider-district" name="district" className="mt-1.5" /></div>
          <div><Label htmlFor="rider-state">State</Label><Input id="rider-state" name="state" required className="mt-1.5" /></div>
          <div><Label htmlFor="rider-pincode">Pincode</Label><Input id="rider-pincode" name="pincode" inputMode="numeric" required className="mt-1.5" /></div>
          <div><Label htmlFor="rider-pan">PAN</Label><Input id="rider-pan" name="pan_no" className="mt-1.5 uppercase" /></div>
          <div><Label htmlFor="rider-aadhaar">Aadhaar</Label><Input id="rider-aadhaar" name="aadhaar_no" inputMode="numeric" className="mt-1.5" /></div>
          <div><Label htmlFor="rider-emergency-name">Emergency contact name</Label><Input id="rider-emergency-name" name="emergency_contact_name" className="mt-1.5" /></div>
          <div><Label htmlFor="rider-emergency-phone">Emergency contact phone</Label><Input id="rider-emergency-phone" name="emergency_contact_phone" className="mt-1.5" /></div>
          <div><Label htmlFor="rider-bank-holder">Bank account holder</Label><Input id="rider-bank-holder" name="bank_account_holder" className="mt-1.5" /></div>
          <div><Label htmlFor="rider-bank-name">Bank name</Label><Input id="rider-bank-name" name="bank_name" className="mt-1.5" /></div>
          <div><Label htmlFor="rider-bank-number">Bank account number</Label><Input id="rider-bank-number" name="bank_account_number" className="mt-1.5" /></div>
          <div><Label htmlFor="rider-bank-ifsc">IFSC</Label><Input id="rider-bank-ifsc" name="bank_ifsc" className="mt-1.5 uppercase" /></div>
          <div><Label htmlFor="rider-upi">UPI ID</Label><Input id="rider-upi" name="upi_id" className="mt-1.5" /></div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-700">
          <button type="button" onClick={() => setTermsOpen((current) => !current)} className="font-bold text-emerald-950">{termsOpen ? "Hide" : "Read"} Rider Terms &amp; Conditions</button>
          {termsOpen ? <p className="mt-3 whitespace-pre-line leading-6">1. Rider information and documents must be genuine and current.{"\n"}2. METHO may hold, suspend, or reject access for safety, fraud, incomplete KYC, or policy violations.{"\n"}3. Rider payouts follow completed-job, dispute, and settlement rules.{"\n"}4. Rider is responsible for lawful vehicle operation and customer safety.</p> : null}
          <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={agreedToTerms} onChange={(event) => setAgreedToTerms(event.target.checked)} /> <span>I have read and agree to the Rider Terms &amp; Conditions.</span></label>
        </div>
        <Button type="submit" disabled={loading || !agreedToTerms} className="w-full h-11 bg-emerald-900 hover:bg-emerald-950 text-white rounded-full">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Submit Registration <ArrowRight className="ml-2 w-4 h-4" /></>}
        </Button>
        <p className="text-center text-sm text-muted-foreground">Already approved? <Link to="/login?role=rider" className="font-semibold text-emerald-900">Rider Login</Link></p>
      </form>
    </div>
  );
}
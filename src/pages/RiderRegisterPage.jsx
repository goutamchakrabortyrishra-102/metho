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
  const nav = useNavigate();

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      await api.post("/rider/register", Object.fromEntries(form.entries()));
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
          <div><Label htmlFor="rider-password">Password</Label><Input id="rider-password" name="password" type="password" minLength={6} required className="mt-1.5" /></div>
          <div><Label htmlFor="rider-whatsapp">WhatsApp</Label><Input id="rider-whatsapp" name="whatsapp" className="mt-1.5" /></div>
          <div><Label htmlFor="rider-vehicle-type">Vehicle type</Label><Input id="rider-vehicle-type" name="vehicle_type" required placeholder="Bike, auto, car" className="mt-1.5" /></div>
          <div><Label htmlFor="rider-vehicle-number">Vehicle number</Label><Input id="rider-vehicle-number" name="vehicle_number" required className="mt-1.5" /></div>
        </div>
        <Button type="submit" disabled={loading} className="w-full h-11 bg-emerald-900 hover:bg-emerald-950 text-white rounded-full">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Submit Registration <ArrowRight className="ml-2 w-4 h-4" /></>}
        </Button>
        <p className="text-center text-sm text-muted-foreground">Already approved? <Link to="/login?role=rider" className="font-semibold text-emerald-900">Rider Login</Link></p>
      </form>
    </div>
  );
}
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Loader2, Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import api from "@/services/api";
import { Logo } from "@/components/Logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
      toast.success("If this account exists, a reset link has been sent.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2" data-testid="forgot-password-page">
      <div className="hidden md:flex bg-gradient-to-br from-emerald-950 to-emerald-800 text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 grain opacity-30" />
        <Logo />
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.25em] text-amber-400 font-semibold">Recover Access</p>
          <h1 className="mt-4 font-display font-black text-5xl leading-none tracking-tight">
            No worries -<br /><span className="text-amber-400 italic">Reset is just a click away.</span>
          </h1>
          <p className="mt-6 text-emerald-100/80 max-w-sm font-body">
            Enter your registered email and we will send a secure reset link valid for 15 minutes.
          </p>
        </div>
        <p className="text-xs text-emerald-100/50 relative">© 2026 Metho Logistics Private Limited</p>
      </div>

      <div className="flex items-center justify-center p-8 md:p-16 bg-background">
        <div className="w-full max-w-md space-y-6">
          <div className="md:hidden"><Logo /></div>

          {!sent ? (
            <form onSubmit={submit} className="space-y-6" data-testid="forgot-form">
              <div>
                <h2 className="font-display font-black text-3xl text-emerald-950 tracking-tight">Forgot Password?</h2>
                <p className="text-sm text-muted-foreground mt-1 font-body">Enter your email to receive a reset link.</p>
              </div>
              <div>
                <Label htmlFor="email">Registered Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@metho.com"
                  data-testid="forgot-email-input"
                  className="mt-1.5 h-11"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-emerald-900 hover:bg-emerald-950 text-white rounded-full font-semibold"
                data-testid="forgot-submit-button"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Send Reset Link <ArrowRight className="ml-2 w-4 h-4" /></>}
              </Button>
              <p className="text-center text-sm text-muted-foreground font-body">
                Remembered your password? <Link to="/login" className="text-emerald-900 font-semibold hover:underline" data-testid="forgot-to-login-link">Sign In</Link>
              </p>
            </form>
          ) : (
            <div className="space-y-6 text-center" data-testid="forgot-success">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-emerald-700" />
              </div>
              <div>
                <h2 className="font-display font-black text-2xl text-emerald-950 tracking-tight">Check your inbox</h2>
                <p className="text-sm text-muted-foreground mt-2 font-body">
                  If <span className="font-semibold text-emerald-900">{email}</span> is registered, we have sent a reset link.
                </p>
                <p className="text-xs text-muted-foreground mt-3 font-body">
                  The link is valid for 15 minutes. Please also check your spam folder.
                </p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-left">
                <div className="flex items-start gap-2">
                  <Mail className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-amber-900">Still not seeing the email?</p>
                    <ul className="text-xs text-amber-800 mt-1 space-y-1 list-disc list-inside">
                      <li>Check Spam / Promotions folders</li>
                      <li>Wait 1-2 minutes</li>
                      <li>If it still does not arrive, <button onClick={() => setSent(false)} className="underline font-semibold" data-testid="forgot-try-again">try again</button></li>
                    </ul>
                  </div>
                </div>
              </div>
              <Link to="/login" className="text-emerald-900 font-semibold hover:underline text-sm">← Back to Sign In</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


import React, { useState, useEffect } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Loader2, KeyRound, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import api from "@/services/api";
import { Logo } from "@/components/Logo";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [tokenValid, setTokenValid] = useState(null); // null=checking, true=ok, false=invalid

  // Client-side JWT validation: check structure, purpose claim, expiry
  useEffect(() => {
    if (!token) { setTokenValid(false); return; }
    try {
      const parts = token.split(".");
      if (parts.length !== 3) throw new Error("Malformed");
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) throw new Error("Expired");
      if (payload.purpose && payload.purpose !== "password_reset") throw new Error("Wrong purpose");
      setTokenValid(true);
    } catch {
      setTokenValid(false);
      toast.error("Reset link invalid or expired");
    }
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    if (password !== confirm) return toast.error("Passwords do not match");
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: password });
      setDone(true);
      toast.success("Password reset complete! Please sign in now.");
      setTimeout(() => nav("/login"), 2000);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2" data-testid="reset-password-page">
      <div className="hidden md:flex bg-gradient-to-br from-emerald-950 to-emerald-800 text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 grain opacity-30" />
        <Logo />
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.25em] text-amber-400 font-semibold">Set New Password</p>
          <h1 className="mt-4 font-display font-black text-5xl leading-none tracking-tight">
            Secure your<br /><span className="text-amber-400 italic">business account.</span>
          </h1>
          <p className="mt-6 text-emerald-100/80 max-w-sm font-body">
            Set a strong new password. We recommend at least 6 characters with one uppercase letter and one number.
          </p>
        </div>
        <p className="text-xs text-emerald-100/50 relative">© 2026 Metho Logistics Private Limited</p>
      </div>

      <div className="flex items-center justify-center p-8 md:p-16 bg-background">
        <div className="w-full max-w-md space-y-6">
          <div className="md:hidden"><Logo /></div>

          {tokenValid === false ? (
            <div className="text-center space-y-4" data-testid="reset-invalid">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
                <AlertCircle className="w-8 h-8 text-red-600" />
              </div>
              <h2 className="font-display font-black text-2xl text-emerald-950">Invalid Reset Link</h2>
              <p className="text-sm text-muted-foreground font-body">
                This link is invalid or expired. Please request a new reset link.
              </p>
              <Link to="/forgot-password" className="inline-block text-emerald-900 font-semibold hover:underline">
                Request New Link
              </Link>
            </div>
          ) : done ? (
            <div className="text-center space-y-4" data-testid="reset-success">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-emerald-700" />
              </div>
              <h2 className="font-display font-black text-2xl text-emerald-950">Password Reset!</h2>
              <p className="text-sm text-muted-foreground font-body">
                Redirecting you to the sign-in page...
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-6" data-testid="reset-form">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <KeyRound className="w-5 h-5 text-emerald-700" />
                </div>
                <div>
                  <h2 className="font-display font-black text-2xl text-emerald-950 tracking-tight">Reset Password</h2>
                  <p className="text-xs text-muted-foreground font-body">Set your new password</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="pw">New Password</Label>
                  <Input
                    id="pw"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    data-testid="reset-password-input"
                    className="mt-1.5 h-11"
                  />
                </div>
                <div>
                  <Label htmlFor="cpw">Confirm New Password</Label>
                  <Input
                    id="cpw"
                    type="password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat password"
                    data-testid="reset-confirm-input"
                    className="mt-1.5 h-11"
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-emerald-900 hover:bg-emerald-950 text-white rounded-full font-semibold"
                data-testid="reset-submit-button"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Reset Password <ArrowRight className="ml-2 w-4 h-4" /></>}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}


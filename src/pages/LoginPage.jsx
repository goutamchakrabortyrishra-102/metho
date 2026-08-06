import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";

export default function LoginPage({ adminOnly = false }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, logout } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const nextUrl = sp.get("next");
  const adminMode = adminOnly || sp.get("admin") === "1" || sp.get("role") === "admin";
  const adminRoles = ["super_admin", "company_admin", "admin"];
  const ownerRoles = ["store_owner", "metho_store_owner", "owner"];

  const extractDetailText = (detail) => {
    if (!detail) return "";
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            if (typeof item.msg === "string") return item.msg;
            if (typeof item.message === "string") return item.message;
          }
          return "";
        })
        .filter(Boolean)
        .join(" | ");
    }
    if (typeof detail === "object") {
      if (typeof detail.message === "string") return detail.message;
      if (typeof detail.msg === "string") return detail.msg;
    }
    return String(detail || "");
  };

  const buildLoginCandidates = (raw) => {
    const input = String(raw || "").trim();
    const candidates = [];
    const push = (v) => {
      const clean = String(v || "").trim();
      if (!clean) return;
      if (!candidates.includes(clean)) candidates.push(clean);
    };

    push(input);
    push(input.toLowerCase());
    push(input.toUpperCase());

    if (adminMode) {
      const compact = input.replace(/\s+/g, "").toLowerCase();
      if (compact === "admin") push("admin@metho.com");
      if (!input.includes("@") && /^[A-Za-z0-9._-]+$/.test(input)) push(`${input}@metho.com`);
      if (compact === "mthadmin" || compact === "mth-admin") push("MTH-ADMIN");
      if (input.toLowerCase() === "admin@metho.com") push("admin");
    }

    return candidates;
  };

  const getErrorMessage = (err) => {
    if (err?.code === "ERR_NETWORK" || !err?.response) {
      return "Server unreachable. Please start backend and try again.";
    }
    const detail = err?.response?.data?.detail;
    const detailText = extractDetailText(detail).toLowerCase();
    const status = Number(err?.response?.status || 0);
    if (status === 422 && (detailText.includes("valid dictionary") || detailText.includes("valid object") || detailText.includes("field required"))) {
      return "Invalid username or password";
    }
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
    if (typeof err?.message === "string" && err.message.trim()) return err.message;
    return "Login failed";
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Read values from form data first to avoid browser autofill/state desync.
      const formData = new FormData(e.currentTarget);
      const safeUsername = String(formData.get("username") ?? username).trim();
      const safePassword = String(formData.get("password") ?? password);
      const candidates = buildLoginCandidates(safeUsername);
      let result = null;
      let lastError = null;
      for (const candidate of candidates) {
        try {
          result = await login(candidate, safePassword, { adminMode });
          break;
        } catch (err) {
          lastError = err;
          const status = Number(err?.response?.status || 0);
          const detail = extractDetailText(err?.response?.data?.detail).toLowerCase();
          const isInvalidCred = err?.response?.status === 401 && detail.includes("invalid username or password");
          const isShapeValidation = status === 422 && (detail.includes("valid dictionary") || detail.includes("valid object") || detail.includes("field required"));
          if (!isInvalidCred && !isShapeValidation) throw err;
        }
      }
      if (!result) throw lastError || new Error("Login failed");
      const isAdminUser = adminRoles.includes(result?.role);
      if (adminMode && !isAdminUser) {
        logout();
        toast.error("This login is only for admins");
        return;
      }
      if (!adminMode && isAdminUser) {
        logout();
        toast.error("Admin users must sign in from hidden admin login");
        return;
      }

      toast.success("Welcome back!");
      // Partners land on their own portal (unless next=... overrides)
      if (nextUrl) nav(nextUrl);
      else if (isAdminUser) nav("/admin");
      else if (result?.role === "partner") nav("/partner");
      else if (ownerRoles.includes(result?.role)) nav("/app/metho-store-owner");
      else nav("/app");
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2" data-testid="login-page">
      <div className="hidden md:flex bg-gradient-to-br from-emerald-950 to-emerald-800 text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 grain opacity-30" />
        <Logo />
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.25em] text-amber-400 font-semibold">Welcome Back</p>
          <h1 className="mt-4 font-display font-black text-5xl leading-none tracking-tight">
            आय की राह में<br /><span className="text-amber-400 italic">एक कदम आगे।</span>
          </h1>
          <p className="mt-6 text-emerald-100/80 max-w-sm font-body">Access your dashboard, wallet, genealogy tree and business cycle — all in one place.</p>
        </div>
        <p className="text-xs text-emerald-100/50 relative">© 2026 Metho Logistics Private Limited</p>
      </div>

      <div className="flex items-center justify-center p-8 md:p-16 bg-background">
        <form onSubmit={submit} className="w-full max-w-md space-y-6" data-testid="login-form">
          <div className="md:hidden"><Logo /></div>
          <div>
            <h2 className="font-display font-black text-3xl text-emerald-950 tracking-tight">{adminMode ? "Admin Sign In" : "Sign In"}</h2>
            <p className="text-sm text-muted-foreground mt-1 font-body">
              {adminMode ? "Admin credentials required" : "Enter your credentials to continue"}
            </p>
          </div>
          <div className="space-y-4">
            <div>
              <Label htmlFor="username">Login ID / Phone / Member Code</Label>
              <Input id="username" name="username" type="text" required value={username} onChange={e => setUsername(e.target.value)} placeholder={adminMode ? "Try: admin or MTH-ADMIN" : "Enter login ID, phone, or member code"} data-testid="login-username-input" className="mt-1.5 h-11" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" data-testid="login-password-input" className="mt-1.5 h-11" />
            </div>
          </div>
          <Button type="submit" disabled={loading} className="w-full h-12 bg-emerald-900 hover:bg-emerald-950 text-white rounded-full font-semibold" data-testid="login-submit-button">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Sign In <ArrowRight className="ml-2 w-4 h-4" /></>}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <Link to="/forgot-password" className="text-emerald-900 hover:underline font-semibold" data-testid="login-forgot-link">Forgot password?</Link>
            <Link to="/register" className="text-slate-500 hover:text-emerald-900" data-testid="login-to-register-link-inline">Create account</Link>
          </div>
          {!adminMode && (
            <p className="text-center text-sm text-muted-foreground font-body">
              No account yet? <Link to="/register" className="text-emerald-900 font-semibold hover:underline" data-testid="login-to-register-link">Register free</Link>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}


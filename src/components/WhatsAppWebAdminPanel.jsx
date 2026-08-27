import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { RadioTower, QrCode, RefreshCw } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Standalone admin panel for the optional WhatsApp Web microservice.
// Fully additive: its own state, own API calls (/admin/whatsapp-web/*), and it
// never touches the Meta Cloud API form/state above it. Admins can switch the
// active outbound provider here at any time without affecting Meta Lead intake.
export default function WhatsAppWebAdminPanel() {
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState(null);
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [serviceUrl, setServiceUrl] = useState("");
  const [serviceToken, setServiceToken] = useState("");

  const loadSettings = () => {
    api.get("/admin/whatsapp-web/settings")
      .then(({ data }) => {
        setSettings(data);
        setServiceUrl(data?.service_url || "");
      })
      .catch(() => setSettings(null));
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const refreshStatus = async () => {
    try {
      const { data } = await api.get("/admin/whatsapp-web/status");
      setStatus(data);
    } catch {
      setStatus(null);
    }
  };

  const refreshQr = async () => {
    try {
      const { data } = await api.get("/admin/whatsapp-web/qr");
      setQr(data);
    } catch {
      setQr(null);
    }
  };

  const saveSettings = async (activeProvider) => {
    setBusy(true);
    setMessage("");
    try {
      const payload = { active_provider: activeProvider ?? settings?.active_provider ?? "meta", service_url: serviceUrl };
      if (serviceToken.trim()) payload.service_token = serviceToken.trim();
      const { data } = await api.put("/admin/whatsapp-web/settings", payload);
      setSettings(data);
      setServiceToken("");
      toast.success("WhatsApp Web provider settings saved.");
    } catch (err) {
      setMessage(err?.response?.data?.detail || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const switchProvider = (provider) => {
    if (!settings || busy) return;
    void saveSettings(provider);
  };

  if (!settings) return null;

  const isWhatsAppWebActive = settings.active_provider === "whatsapp_web";

  return (
    <div className="bg-white rounded-xl border border-border p-6" data-testid="whatsapp-web-admin-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
            <RadioTower className="w-4.5 h-4.5 text-emerald-800" />
          </div>
          <div>
            <h3 className="font-display font-bold text-emerald-950">WhatsApp Web Automation (Optional)</h3>
            <p className="text-xs text-muted-foreground font-body mt-0.5">
              Switch outbound sending between Meta Cloud API and a self-hosted WhatsApp Web
              session — without templates. Switching here never disables Meta Lead intake above.
            </p>
          </div>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-widest bg-amber-100 text-amber-800 px-2 py-1 rounded-full">
          Active: {settings.active_provider === "whatsapp_web" ? "WhatsApp Web" : "Meta Cloud API"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant={settings.active_provider === "meta" ? "default" : "outline"} onClick={() => switchProvider("meta")} disabled={busy} data-testid="whatsapp-web-provider-meta">
          Use Meta Cloud API
        </Button>
        <Button type="button" variant={isWhatsAppWebActive ? "default" : "outline"} onClick={() => switchProvider("whatsapp_web")} disabled={busy} data-testid="whatsapp-web-provider-web">
          Use WhatsApp Web
        </Button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <Label>WhatsApp Web Service URL</Label>
          <Input
            value={serviceUrl}
            onChange={(e) => setServiceUrl(e.target.value)}
            placeholder="https://metho-whatsapp-web.onrender.com"
            className="mt-1.5 h-11"
            data-testid="whatsapp-web-service-url"
          />
        </div>
        <div>
          <Label>Service Token</Label>
          <Input
            type="password"
            value={serviceToken}
            onChange={(e) => setServiceToken(e.target.value)}
            placeholder={settings.service_token_masked || "Leave empty to keep existing"}
            className="mt-1.5 h-11"
            data-testid="whatsapp-web-service-token"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => saveSettings()} disabled={busy} data-testid="whatsapp-web-save">Save</Button>
        <Button type="button" variant="outline" onClick={refreshStatus} disabled={busy} data-testid="whatsapp-web-refresh-status">
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh Status
        </Button>
        <Button type="button" variant="outline" onClick={refreshQr} disabled={busy} data-testid="whatsapp-web-refresh-qr">
          <QrCode className="w-4 h-4 mr-1" /> Get QR Code
        </Button>
        {message ? <span className="text-xs text-red-600">{message}</span> : null}
      </div>

      {status ? (
        <p className="mt-3 text-xs text-slate-600" data-testid="whatsapp-web-status-text">
          {status.ok ? `Ready: ${status.ready ? "Yes" : "No"}${status.lastError ? ` — ${status.lastError}` : ""}` : (status.error || "Status unavailable")}
        </p>
      ) : null}

      {qr?.qrDataUri ? (
        <div className="mt-3">
          <img src={qr.qrDataUri} alt="WhatsApp Web QR code" className="h-48 w-48 border border-border rounded-lg p-2 bg-white" />
          <p className="text-[11px] text-muted-foreground mt-1">Scan with WhatsApp &gt; Linked Devices.</p>
        </div>
      ) : null}
    </div>
  );
}

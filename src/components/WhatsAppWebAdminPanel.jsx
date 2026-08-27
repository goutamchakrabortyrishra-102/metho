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
  const [notice, setNotice] = useState("");
  const [recipient, setRecipient] = useState("");
  const [pdf, setPdf] = useState(null);
  const [storage, setStorage] = useState(null);
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

  const refreshStorage = async () => {
    try {
      const { data } = await api.get("/admin/whatsapp-web/storage");
      setStorage(data?.ok ? data : null);
    } catch {
      setStorage(null);
    }
  };

  useEffect(() => {
    loadSettings();
    void refreshStorage();
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
    setNotice("");
    try {
      const payload = { active_provider: activeProvider ?? settings?.active_provider ?? "meta", service_url: serviceUrl };
      if (serviceToken.trim()) payload.service_token = serviceToken.trim();
      const { data } = await api.put("/admin/whatsapp-web/settings", payload);
      setSettings(data);
      setServiceToken("");
      toast.success("WhatsApp Web provider settings saved.");
    } catch (err) {
      setNotice(err?.response?.data?.detail || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const switchProvider = (provider) => {
    if (!settings || busy) return;
    void saveSettings(provider);
  };

  const sendMessage = async () => {
    if (!recipient.trim() || !message.trim()) {
      setNotice("Enter a WhatsApp number and message.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const { data } = await api.post("/admin/whatsapp-web/send-test", { to: recipient.trim(), message: message.trim() });
      if (!data?.ok) throw new Error(data?.error || "Message could not be sent");
      toast.success("WhatsApp message sent.");
      setMessage("");
    } catch (err) {
      setNotice(err?.response?.data?.detail || err?.message || "Message send failed");
    } finally {
      setBusy(false);
    }
  };

  const sendPdf = async () => {
    if (!recipient.trim() || !pdf?.base64) {
      setNotice("Enter a WhatsApp number and choose a PDF.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const { data } = await api.post("/admin/whatsapp-web/send-pdf", {
        to: recipient.trim(), pdf_base64: pdf.base64, filename: pdf.name, caption: message.trim() || "METHO document",
      });
      if (!data?.ok) throw new Error(data?.error || "PDF could not be sent");
      toast.success("PDF sent to WhatsApp.");
      setPdf(null);
    } catch (err) {
      setNotice(err?.response?.data?.detail || err?.message || "PDF send failed");
    } finally {
      setBusy(false);
    }
  };

  const handlePdfChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf" || file.size > 10 * 1024 * 1024) {
      setNotice("Choose a PDF file smaller than 10 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPdf({ name: file.name, base64: String(reader.result || "").split(",")[1] || "" });
    reader.readAsDataURL(file);
  };

  const cleanupStorage = async () => {
    setBusy(true);
    setNotice("");
    try {
      const { data } = await api.post("/admin/whatsapp-web/storage/cleanup");
      setStorage(data);
      toast.success(`Old cache cleared (${Math.round((data?.freedBytes || 0) / 1024 / 1024)} MB).`);
    } catch (err) {
      setNotice(err?.response?.data?.detail || "Storage cleanup failed");
    } finally {
      setBusy(false);
    }
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
        {notice ? <span className="text-xs text-red-600">{notice}</span> : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,0.45fr)_minmax(0,1fr)_auto]">
        <Input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Customer WhatsApp number"
          className="h-11"
          data-testid="whatsapp-web-message-recipient"
        />
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Invoice, offer, or approved-template message"
          className="h-11"
          data-testid="whatsapp-web-message-template"
        />
        <Button type="button" onClick={sendMessage} disabled={busy} data-testid="whatsapp-web-send-message">
          Send Message
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input type="file" accept="application/pdf" onChange={handlePdfChange} className="max-w-xs h-11" data-testid="whatsapp-web-pdf-file" />
        <Button type="button" variant="outline" onClick={sendPdf} disabled={busy || !pdf} data-testid="whatsapp-web-send-pdf">
          Send PDF
        </Button>
        {pdf ? <span className="text-xs text-muted-foreground">{pdf.name}</span> : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>Web session storage: {storage ? `${(Number(storage.storageBytes || 0) / 1024 / 1024).toFixed(1)} MB` : "Unavailable"}</span>
        <Button type="button" size="sm" variant="outline" onClick={refreshStorage} disabled={busy}>Refresh Storage</Button>
        <Button type="button" size="sm" variant="outline" onClick={cleanupStorage} disabled={busy}>Clear Old Cache</Button>
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

// Standalone HTTP wrapper around the WhatsApp Web automation client.
// Deployed as its own service, fully independent from the FastAPI backend
// and from the React frontend build. The FastAPI backend talks to this over
// HTTP only when the admin explicitly switches the "active provider" to
// "whatsapp_web" — the Meta Cloud API path is completely untouched.
const express = require('express');
const cors = require('cors');
const {
  initializeWhatsAppWebClient,
  getSessionStatus,
  getStorageStatus,
  cleanupStorage,
  resetSession,
  sendTextMessage,
  sendPdfInvoice,
} = require('./services/whatsappWeb');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const SERVICE_TOKEN = process.env.WHATSAPP_WEB_SERVICE_TOKEN || '';

function requireToken(req, res, next) {
  if (!SERVICE_TOKEN) {
    // Fail-safe: refuse to run unauthenticated in any real deployment.
    return res.status(503).json({ ok: false, error: 'WHATSAPP_WEB_SERVICE_TOKEN is not configured' });
  }
  const provided = req.get('x-service-token') || '';
  if (provided !== SERVICE_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Invalid or missing service token' });
  }
  return next();
}

app.get('/health', (req, res) => {
  res.json({ ok: true, ready: getSessionStatus().ready });
});

app.get('/status', requireToken, (req, res) => {
  res.json({ ok: true, success: true, ...getSessionStatus() });
});

app.get('/qr', requireToken, (req, res) => {
  const status = getSessionStatus();
  res.json({ ok: true, qrDataUri: status.qrDataUri, ready: status.ready, lastError: status.lastError });
});

app.get('/storage', requireToken, (req, res) => {
  res.json({ ok: true, ...getStorageStatus() });
});

app.post('/storage/cleanup', requireToken, (req, res) => {
  res.json({ ok: true, ...cleanupStorage() });
});

app.post('/reset-session', requireToken, async (req, res) => {
  try {
    await resetSession();
    res.json({ ok: true, ready: false, message: 'Session reset. Scan the new QR code.' });
  } catch (error) {
    console.error('[whatsapp-web-service] /reset-session failed:', error.message);
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.post('/send-text', requireToken, async (req, res) => {
  try {
    const { to, message } = req.body || {};
    const result = await sendTextMessage(to, message);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[whatsapp-web-service] /send-text failed:', error.message);
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.post('/send-pdf', requireToken, async (req, res) => {
  try {
    const { to, filename, caption, pdf_base64: pdfBase64 } = req.body || {};
    const result = await sendPdfInvoice(to, pdfBase64, filename, caption);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[whatsapp-web-service] /send-pdf failed:', error.message);
    res.status(503).json({ ok: false, error: error.message });
  }
});

// Initialize the client at boot so the QR code / session is ready to serve immediately.
try {
  initializeWhatsAppWebClient();
} catch (error) {
  console.error('[whatsapp-web-service] Startup init failed (server still runs, client can be retried):', error.message);
}

const PORT = process.env.PORT || 4100;
app.listen(PORT, () => {
  console.log(`[whatsapp-web-service] Listening on port ${PORT}`);
});

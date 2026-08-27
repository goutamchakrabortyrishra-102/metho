# Optional WhatsApp Web Automation Service

This helper is intentionally isolated from the existing Meta Cloud API integration.

## Why this is safe
- It lives in `services/whatsappWeb.js`.
- It does not replace the current database schema or route structure.
- It does not modify the existing Meta integration or WhatsApp Cloud API configuration flow.
- It is optional and can be enabled only if the server is configured to run this helper.

## Initialization pattern

In your main Node.js app entry file, initialize this service only when you explicitly want the WhatsApp Web automation to run:

```js
const { initializeWhatsAppWebClient, getQrCodeData, getSessionStatus } = require('./services/whatsappWeb');

// Optional: start the automation client only if you want QR login and browser-based automation.
initializeWhatsAppWebClient();

// Example admin endpoint:
// app.get('/api/whatsapp-web/qr', (req, res) => {
//   res.json({ qr: getQrCodeData(), status: getSessionStatus() });
// });
```

## Notes
- The client stores browser session data in the local `whatsapp-session` folder.
- On the first login, the QR code is stored and can be exported to the admin UI.
- If the client is disconnected or not ready, `sendTextMessage` and `sendPdfInvoice` throw explicit errors instead of crashing the app.
- This is a best-effort browser automation path and should be treated as separate from the production Meta Cloud WhatsApp integration.

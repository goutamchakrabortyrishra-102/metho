# METHO WhatsApp Web Service (optional, isolated)

A standalone microservice that runs `whatsapp-web.js` (browser-based WhatsApp automation).
It is **not** part of the React frontend build and **not** part of the FastAPI backend process —
it is deployed and scaled independently, and the main backend only talks to it over HTTP,
and only when an admin explicitly switches the "active WhatsApp provider" to `whatsapp_web`.

## Why a separate service
- `whatsapp-web.js` depends on Puppeteer (bundles a full Chromium). Bundling that into the
  frontend build or the Python backend would bloat/break those deployments (this happened
  once already when the dependency was accidentally added to the frontend `package.json`).
- Running it as its own Docker-based service keeps the Meta Cloud API integration and the
  Cloudflare Pages frontend build completely unaffected — this service can be deployed,
  restarted, or turned off at any time with zero impact on the rest of the platform.

## Endpoints (all except /health require header `x-service-token: <WHATSAPP_WEB_SERVICE_TOKEN>`)
- `GET /health` — liveness check, no auth.
- `GET /status` — `{ ready, connected, qrDataUri, lastError }`.
- `GET /qr` — `{ qrDataUri, ready, lastError }` for the admin to scan.
- `POST /send-text` — `{ to, message }`.
- `POST /send-pdf` — `{ to, filename, caption, pdf_base64 }`.
- `POST /reset-session` — deletes corrupted auth files and starts a new QR session.

## Deploying on Render
This repo's `render.yaml` includes a second service block (`Metho-whatsapp-web`, Docker
runtime, `rootDir: whatsapp-web-service`) stores LocalAuth under
`/tmp/.wwebjs_auth` to avoid Render permission issues. Render clears `/tmp` on a service restart,
so scan the QR code again after a restart or after resetting the session.
Set the `WHATSAPP_WEB_SERVICE_TOKEN` env var (any long random string) on that service, and the
same value in the main backend's `WHATSAPP_WEB_SERVICE_TOKEN` env var so it can authenticate.

## Local run
```
cd whatsapp-web-service
npm install
WHATSAPP_WEB_SERVICE_TOKEN=dev-secret node server.js
```
Then scan the QR from `GET /qr` (base64 image). Use authenticated `POST /reset-session` only when
the saved session is corrupted; it deletes auth files and generates a new QR code.

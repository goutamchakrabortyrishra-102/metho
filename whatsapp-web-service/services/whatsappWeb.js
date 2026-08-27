const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const SESSION_DIR = path.resolve(process.cwd(), 'whatsapp-session');
const QR_CODE_PATH = path.resolve(SESSION_DIR, 'qr-code.txt');

const state = {
  client: null,
  ready: false,
  qrCode: null,
  qrDataUri: null,
  lastError: null,
};

function ensureSessionDir() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function createClient() {
  ensureSessionDir();

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR, session: 'metho-whatsapp-web' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
    takeoverOnConflict: false,
  });

  client.on('qr', async (qr) => {
    state.qrCode = qr;
    try {
      state.qrDataUri = await QRCode.toDataURL(qr);
      fs.writeFileSync(QR_CODE_PATH, String(qr));
    } catch (error) {
      console.error('[whatsapp-web-service] QR encode/save failed:', error.message);
    }
    console.log('[whatsapp-web-service] QR generated. Scan it from the admin panel.');
  });

  client.on('authenticated', () => {
    state.ready = true;
    state.lastError = null;
    console.log('[whatsapp-web-service] Authenticated successfully.');
  });

  client.on('auth_failure', (message) => {
    state.ready = false;
    state.lastError = message || 'Authentication failed';
    console.error('[whatsapp-web-service] Auth failure:', state.lastError);
  });

  client.on('ready', () => {
    state.ready = true;
    state.lastError = null;
    state.qrCode = null;
    state.qrDataUri = null;
    console.log('[whatsapp-web-service] Client ready.');
  });

  client.on('disconnected', (reason) => {
    state.ready = false;
    state.lastError = reason || 'Client disconnected';
    console.warn('[whatsapp-web-service] Disconnected:', state.lastError);
  });

  return client;
}

function initializeWhatsAppWebClient() {
  if (state.client) return state.client;
  state.client = createClient();
  state.client.initialize();
  return state.client;
}

function getSessionStatus() {
  return {
    ready: !!state.ready,
    connected: !!state.ready,
    qrDataUri: state.qrDataUri || null,
    lastError: state.lastError || null,
  };
}

async function sendTextMessage(to, message) {
  const client = initializeWhatsAppWebClient();
  if (!state.ready || !client) {
    throw new Error('WhatsApp Web client is not ready');
  }
  const formatted = String(to || '').trim();
  const text = String(message || '').trim();
  if (!formatted || !text) {
    throw new Error('Recipient and message are required');
  }
  const chatId = formatted.includes('@c.us') ? formatted : `${formatted.replace(/\D/g, '')}@c.us`;
  await client.sendMessage(chatId, text);
  return { ok: true, to: formatted };
}

async function sendPdfInvoice(to, pdfBufferOrBase64, filename, caption = 'Invoice') {
  const client = initializeWhatsAppWebClient();
  if (!state.ready || !client) {
    throw new Error('WhatsApp Web client is not ready');
  }
  const recipient = String(to || '').trim();
  if (!recipient) {
    throw new Error('Recipient is required');
  }

  let base64Data;
  if (Buffer.isBuffer(pdfBufferOrBase64)) {
    base64Data = pdfBufferOrBase64.toString('base64');
  } else if (typeof pdfBufferOrBase64 === 'string') {
    base64Data = pdfBufferOrBase64;
  } else {
    throw new Error('PDF input must be a Buffer or base64 string');
  }

  const chatId = recipient.includes('@c.us') ? recipient : `${recipient.replace(/\D/g, '')}@c.us`;
  const pdfName = String(filename || 'invoice.pdf').trim() || 'invoice.pdf';
  const media = new MessageMedia('application/pdf', base64Data, pdfName);
  await client.sendMessage(chatId, media, { caption: String(caption || 'Invoice') });
  return { ok: true, to: recipient, filename: pdfName };
}

module.exports = {
  initializeWhatsAppWebClient,
  getSessionStatus,
  sendTextMessage,
  sendPdfInvoice,
  state,
};

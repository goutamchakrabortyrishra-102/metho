const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const SESSION_DIR = path.resolve(process.cwd(), 'whatsapp-session');
const QR_CODE_PATH = path.resolve(process.cwd(), 'whatsapp-session', 'qr-code.txt');

const state = {
  client: null,
  ready: false,
  qrCode: null,
  lastError: null,
};

function ensureSessionDir() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function createClient() {
  ensureSessionDir();

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: SESSION_DIR,
      session: 'metho-whatsapp-web',
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
    takeoverOnConflict: false,
    retryMap: new Map(),
  });

  client.on('qr', (qr) => {
    state.qrCode = qr;
    try {
      fs.writeFileSync(QR_CODE_PATH, String(qr));
    } catch (error) {
      console.error('WhatsApp Web QR save failed:', error.message);
    }
    console.log('[whatsapp-web] QR generated. Scan it in the admin panel or terminal.');
  });

  client.on('authenticated', () => {
    state.ready = true;
    state.lastError = null;
    console.log('[whatsapp-web] Authenticated successfully.');
  });

  client.on('auth_failure', (message) => {
    state.ready = false;
    state.lastError = message || 'Authentication failed';
    console.error('[whatsapp-web] Auth failure:', state.lastError);
  });

  client.on('ready', () => {
    state.ready = true;
    state.lastError = null;
    console.log('[whatsapp-web] Client ready.');
  });

  client.on('disconnected', (reason) => {
    state.ready = false;
    state.lastError = reason || 'Client disconnected';
    console.warn('[whatsapp-web] Disconnected:', state.lastError);
  });

  client.on('message', (msg) => {
    if (msg.body && msg.body.toLowerCase() === '!status') {
      msg.reply('METHO WhatsApp Web automation online.');
    }
  });

  return client;
}

function initializeWhatsAppWebClient() {
  if (state.client) {
    return state.client;
  }

  state.client = createClient();
  state.client.initialize();
  return state.client;
}

function getQrCodeData() {
  if (state.qrCode) {
    return state.qrCode;
  }

  try {
    if (fs.existsSync(QR_CODE_PATH)) {
      return fs.readFileSync(QR_CODE_PATH, 'utf8').trim();
    }
  } catch (error) {
    console.error('[whatsapp-web] Could not read saved QR:', error.message);
  }

  return null;
}

function getSessionStatus() {
  return {
    ready: !!state.ready,
    connected: !!state.ready,
    qrCode: state.qrCode || getQrCodeData(),
    lastError: state.lastError || null,
  };
}

async function sendTextMessage(to, message) {
  try {
    const client = initializeWhatsAppWebClient();
    if (!state.ready || !client || !client.isReady) {
      throw new Error('WhatsApp Web client is not ready');
    }

    const formatted = String(to || '').trim();
    const text = String(message || '').trim();
    if (!formatted || !text) {
      throw new Error('Recipient and message are required');
    }

    await client.sendMessage(formatted, text);
    return { ok: true, to: formatted };
  } catch (error) {
    console.error('[whatsapp-web] sendTextMessage failed:', error.message);
    throw error;
  }
}

async function sendPdfInvoice(to, pdfBufferOrPath, filename, caption = 'Invoice') {
  try {
    const client = initializeWhatsAppWebClient();
    if (!state.ready || !client || !client.isReady) {
      throw new Error('WhatsApp Web client is not ready');
    }

    const recipient = String(to || '').trim();
    if (!recipient) {
      throw new Error('Recipient is required');
    }

    let mediaBuffer;
    if (Buffer.isBuffer(pdfBufferOrPath)) {
      mediaBuffer = pdfBufferOrPath;
    } else if (typeof pdfBufferOrPath === 'string') {
      const resolvedPath = path.isAbsolute(pdfBufferOrPath)
        ? pdfBufferOrPath
        : path.resolve(process.cwd(), pdfBufferOrPath);
      mediaBuffer = fs.readFileSync(resolvedPath);
    } else {
      throw new Error('PDF input must be a Buffer or file path');
    }

    const pdfName = String(filename || 'invoice.pdf').trim() || 'invoice.pdf';
    const media = new MessageMedia('application/pdf', mediaBuffer.toString('base64'), pdfName);
    await client.sendMessage(recipient, media, { caption: String(caption || 'Invoice') });
    return { ok: true, to: recipient, filename: pdfName };
  } catch (error) {
    console.error('[whatsapp-web] sendPdfInvoice failed:', error.message);
    throw error;
  }
}

module.exports = {
  initializeWhatsAppWebClient,
  getQrCodeData,
  getSessionStatus,
  sendTextMessage,
  sendPdfInvoice,
  state,
};

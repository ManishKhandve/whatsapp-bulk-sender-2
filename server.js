const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const QRCode = require('qrcode');
const { Client, NoAuth, MessageMedia } = require('whatsapp-web.js');

// ─── Express & Socket.IO Setup ───────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── File Upload Setup ───────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `contacts_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) cb(null, true);
    else cb(new Error('Only Excel files (.xlsx, .xls, .csv) are allowed'));
  }
});

const imageUpload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ─── WhatsApp Client ─────────────────────────────────────────────────────────
let whatsappClient = null;
let whatsappStatus = 'disconnected'; // disconnected | qr_pending | authenticated | ready
let currentCampaign = null;

function initWhatsApp() {
  whatsappClient = new Client({
    authStrategy: new NoAuth(),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu'
      ]
    }
  });

  whatsappClient.on('qr', async (qr) => {
    whatsappStatus = 'qr_pending';
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
      io.emit('qr', qrDataUrl);
      io.emit('status', { status: whatsappStatus, message: 'Scan QR code with WhatsApp' });
    } catch (err) {
      console.error('QR generation error:', err);
    }
  });

  whatsappClient.on('authenticated', () => {
    whatsappStatus = 'authenticated';
    io.emit('status', { status: whatsappStatus, message: 'Authenticated! Loading chats...' });
    console.log('✓ WhatsApp authenticated');
  });

  whatsappClient.on('ready', () => {
    whatsappStatus = 'ready';
    io.emit('status', { status: whatsappStatus, message: 'WhatsApp is ready!' });
    console.log('✓ WhatsApp client ready');
  });

  whatsappClient.on('auth_failure', (msg) => {
    whatsappStatus = 'disconnected';
    io.emit('status', { status: whatsappStatus, message: `Auth failed: ${msg}` });
    console.error('✗ Auth failure:', msg);
  });

  whatsappClient.on('disconnected', (reason) => {
    whatsappStatus = 'disconnected';
    io.emit('status', { status: whatsappStatus, message: `Disconnected: ${reason}` });
    console.log('✗ Disconnected:', reason);
  });

  whatsappClient.initialize().catch(err => {
    console.error('WhatsApp init error:', err);
    whatsappStatus = 'disconnected';
    io.emit('status', { status: 'disconnected', message: `Init error: ${err.message}` });
  });
}

// ─── Utility Functions ───────────────────────────────────────────────────────

function formatPhone(phone, defaultCountryCode = '91') {
  let cleaned = String(phone).replace(/[\s\-\(\)\+]/g, '');
  // Remove leading zeros
  cleaned = cleaned.replace(/^0+/, '');
  // If 10 digits, prepend country code
  if (cleaned.length === 10) {
    cleaned = defaultCountryCode + cleaned;
  }
  return cleaned;
}

function personalizeMessage(template, contact) {
  let msg = template;
  msg = msg.replace(/\{\{name\}\}/gi, contact.name || '');
  msg = msg.replace(/\{\{phone\}\}/gi, contact.phone || '');
  msg = msg.replace(/\{\{company\}\}/gi, contact.company || '');
  return msg;
}

function randomDelay(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

// ─── API Routes ──────────────────────────────────────────────────────────────

// Get WhatsApp status
app.get('/api/status', (req, res) => {
  res.json({ status: whatsappStatus });
});

// Upload Image
app.post('/api/upload-image', imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  res.json({ success: true, imagePath: req.file.path, imageName: req.file.originalname });
});

// Upload and parse Excel
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (rawData.length === 0) {
      return res.status(400).json({ error: 'Excel sheet is empty' });
    }

    // Filter out empty rows
    const rows = rawData.filter(row => row && row.length > 0);

    let startIndex = 0;
    // Check if the very first cell is a textual header (not a phone number)
    const firstCell = String(rows[0][0] || '').trim();
    if (firstCell && !/\d/.test(firstCell)) {
      // If it doesn't contain digits, it's likely a header like "Phone" or "Number"
      startIndex = 1;
    }

    const contacts = [];
    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0]) continue; // skip if first column is empty

      const phoneRaw = String(row[0]).trim();
      const formattedPhone = formatPhone(phoneRaw, req.body?.countryCode || '91');

      if (formattedPhone && formattedPhone.length >= 10) {
        contacts.push({
          id: i + 1,
          phone: formattedPhone,
          name: row[1] ? String(row[1]).trim() : '',
          company: row[2] ? String(row[2]).trim() : '',
          raw: phoneRaw
        });
      }
    }

    // Clean up uploaded file
    fs.unlink(req.file.path, () => {});

    res.json({
      totalRows: rawData.length,
      validContacts: contacts.length,
      contacts,
      detectedColumns: { phone: 'Column 1', name: 'Column 2', company: 'Column 3' }
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to parse Excel file: ' + err.message });
  }
});

// Start campaign
app.post('/api/start-campaign', async (req, res) => {
  if (whatsappStatus !== 'ready') {
    return res.status(400).json({ error: 'WhatsApp is not connected. Scan QR first.' });
  }
  if (currentCampaign && currentCampaign.running) {
    return res.status(400).json({ error: 'A campaign is already running.' });
  }

  const { contacts, message, imagePath, batchSize = 3, minDelay = 5, maxDelay = 15, minBatchPause = 30, maxBatchPause = 90, countryCode = '91' } = req.body;

  if (!contacts || contacts.length === 0) {
    return res.status(400).json({ error: 'No contacts provided' });
  }
  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message template is empty' });
  }

  currentCampaign = {
    running: true,
    paused: false,
    total: contacts.length,
    sent: 0,
    failed: 0,
    currentIndex: 0
  };

  res.json({ success: true, message: 'Campaign started', total: contacts.length });

  // Run campaign asynchronously
  (async () => {
    for (let i = 0; i < contacts.length; i++) {
      if (!currentCampaign.running) {
        io.emit('campaign-log', { type: 'info', message: '⏹ Campaign stopped by user', timestamp: new Date().toISOString() });
        break;
      }

      // Handle pause
      while (currentCampaign.paused && currentCampaign.running) {
        await randomDelay(1000, 1000);
      }
      if (!currentCampaign.running) break;

      const contact = contacts[i];
      const chatId = contact.phone + '@c.us';
      const personalizedMsg = personalizeMessage(message, contact);

      currentCampaign.currentIndex = i;

      try {
        io.emit('campaign-log', {
          type: 'sending',
          message: `📤 Sending to ${contact.name || contact.phone} (${contact.phone})...`,
          contactId: contact.id,
          timestamp: new Date().toISOString()
        });

        if (imagePath && fs.existsSync(imagePath)) {
          const media = MessageMedia.fromFilePath(imagePath);
          await whatsappClient.sendMessage(chatId, media, { caption: personalizedMsg });
        } else {
          await whatsappClient.sendMessage(chatId, personalizedMsg);
        }

        currentCampaign.sent++;
        io.emit('campaign-log', {
          type: 'sent',
          message: `✅ Sent to ${contact.name || contact.phone} (${contact.phone})`,
          contactId: contact.id,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        currentCampaign.failed++;
        io.emit('campaign-log', {
          type: 'failed',
          message: `❌ Failed: ${contact.name || contact.phone} (${contact.phone}) — ${err.message}`,
          contactId: contact.id,
          timestamp: new Date().toISOString()
        });
      }

      // Send progress update
      io.emit('campaign-progress', {
        total: currentCampaign.total,
        sent: currentCampaign.sent,
        failed: currentCampaign.failed,
        currentIndex: i + 1,
        running: currentCampaign.running
      });

      // Delay logic: after every `batchSize` messages, take a longer pause
      if (currentCampaign.running && i < contacts.length - 1) {
        const isEndOfBatch = (i + 1) % batchSize === 0;
        if (isEndOfBatch) {
          const pauseSec = Math.floor(Math.random() * (maxBatchPause - minBatchPause + 1)) + minBatchPause;
          io.emit('campaign-log', {
            type: 'waiting',
            message: `⏳ Batch complete! Waiting ${pauseSec}s before next batch...`,
            timestamp: new Date().toISOString()
          });
          await randomDelay(pauseSec * 1000, pauseSec * 1000);
        } else {
          const delaySec = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
          io.emit('campaign-log', {
            type: 'waiting',
            message: `⏳ Waiting ${delaySec}s...`,
            timestamp: new Date().toISOString()
          });
          await randomDelay(delaySec * 1000, delaySec * 1000);
        }
      }
    }

    if (currentCampaign.running) {
      io.emit('campaign-log', {
        type: 'complete',
        message: `🎉 Campaign complete! Sent: ${currentCampaign.sent}, Failed: ${currentCampaign.failed}`,
        timestamp: new Date().toISOString()
      });
    }

    io.emit('campaign-progress', {
      total: currentCampaign.total,
      sent: currentCampaign.sent,
      failed: currentCampaign.failed,
      currentIndex: currentCampaign.total,
      running: false
    });

    currentCampaign.running = false;
  })();
});

// Stop campaign
app.post('/api/stop-campaign', (req, res) => {
  if (currentCampaign) {
    currentCampaign.running = false;
    res.json({ success: true, message: 'Campaign stopping...' });
  } else {
    res.json({ success: false, message: 'No campaign running' });
  }
});

// Pause / Resume campaign
app.post('/api/pause-campaign', (req, res) => {
  if (currentCampaign && currentCampaign.running) {
    currentCampaign.paused = !currentCampaign.paused;
    const state = currentCampaign.paused ? 'paused' : 'resumed';
    io.emit('campaign-log', {
      type: 'info',
      message: `⏸ Campaign ${state}`,
      timestamp: new Date().toISOString()
    });
    res.json({ success: true, paused: currentCampaign.paused });
  } else {
    res.json({ success: false, message: 'No campaign running' });
  }
});

// Logout WhatsApp
app.post('/api/logout', async (req, res) => {
  try {
    if (whatsappClient) {
      await whatsappClient.logout();
      await whatsappClient.destroy();
      whatsappClient = null;
    }
    whatsappStatus = 'disconnected';
    io.emit('status', { status: 'disconnected', message: 'Logged out' });
    // Re-init for new QR
    initWhatsApp();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Socket.IO ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('→ Client connected');
  socket.emit('status', { status: whatsappStatus, message: getStatusMessage() });

  if (currentCampaign) {
    socket.emit('campaign-progress', {
      total: currentCampaign.total,
      sent: currentCampaign.sent,
      failed: currentCampaign.failed,
      currentIndex: currentCampaign.currentIndex,
      running: currentCampaign.running
    });
  }
});

function getStatusMessage() {
  switch (whatsappStatus) {
    case 'disconnected': return 'WhatsApp not connected. Initializing...';
    case 'qr_pending': return 'Scan the QR code with your WhatsApp';
    case 'authenticated': return 'Authenticated! Loading chats...';
    case 'ready': return 'WhatsApp is connected and ready!';
    default: return '';
  }
}

// ─── Start Server ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Cleanly Message running at http://localhost:${PORT}\n`);
  initWhatsApp();
});

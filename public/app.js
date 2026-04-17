/* ═══════════════════════════════════════════════════════════════════════════
   Cleanly Message — Frontend App Logic
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── State ────────────────────────────────────────────────────────────────
let contacts = [];
let campaignRunning = false;
let campaignPaused = false;

// ─── DOM Elements ─────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const statusBadge = $('#status-badge');
const statusText = $('#status-text');
const btnLogout = $('#btn-logout');
const qrSection = $('#qr-section');
const qrContainer = $('#qr-container');
const dashboard = $('#dashboard');
const dropZone = $('#drop-zone');
const fileInput = $('#file-input');
const fileInfo = $('#file-info');
const fileName = $('#file-name');
const contactsCount = $('#contacts-count');
const messageInput = $('#message-input');
const charCount = $('#char-count');
const imageInput = $('#image-input');
const imageInfo = $('#image-info');
const imageName = $('#image-name');
const btnRemoveImage = $('#btn-remove-image');
const contactsSection = $('#contacts-section');
const contactsTbody = $('#contacts-tbody');
const previewCount = $('#preview-count');
const btnStart = $('#btn-start');
const btnPause = $('#btn-pause');
const btnStop = $('#btn-stop');
const statTotal = $('#stat-total');
const statSent = $('#stat-sent');
const statFailed = $('#stat-failed');
const statRemaining = $('#stat-remaining');
const progressFill = $('#progress-fill');
const progressText = $('#progress-text');
const logContainer = $('#log-container');
const btnClearLog = $('#btn-clear-log');

// ─── Socket.IO Connection ────────────────────────────────────────────────
const socket = io();

socket.on('status', (data) => {
  updateStatus(data.status, data.message);
});

socket.on('qr', (qrDataUrl) => {
  qrContainer.innerHTML = `<img src="${qrDataUrl}" alt="WhatsApp QR Code" />`;
});

socket.on('campaign-log', (data) => {
  addLogEntry(data.type, data.message, data.timestamp);

  // Update contact row status
  if (data.contactId !== undefined) {
    updateContactRow(data.contactId, data.type);
  }
});

socket.on('campaign-progress', (data) => {
  updateProgress(data);
});

// ─── Status Management ───────────────────────────────────────────────────
function updateStatus(status, message) {
  statusBadge.className = `status-badge ${status}`;
  statusText.textContent = message || status;

  if (status === 'ready') {
    qrSection.style.display = 'none';
    dashboard.style.display = 'flex';
    btnLogout.style.display = 'flex';
  } else {
    qrSection.style.display = 'block';
    dashboard.style.display = 'none';
    btnLogout.style.display = 'none';
  }

  if (status === 'disconnected') {
    qrContainer.innerHTML = `
      <div class="qr-placeholder">
        <div class="spinner"></div>
        <p>Generating QR code...</p>
      </div>`;
  }
}

// ─── File Upload ──────────────────────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) {
    uploadFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    uploadFile(fileInput.files[0]);
  }
});

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('countryCode', $('#country-code').value || '91');

  try {
    showToast('info', 'Uploading and parsing Excel file...');
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      showToast('error', data.error || 'Upload failed');
      return;
    }

    contacts = data.contacts;

    // Show file info
    fileName.textContent = file.name;
    contactsCount.textContent = `${data.validContacts} contacts`;
    fileInfo.style.display = 'flex';

    // Populate contacts table
    renderContactsTable();

    // Enable start button
    checkStartButton();

    showToast('success', `Loaded ${data.validContacts} contacts from ${data.totalRows} rows`);
  } catch (err) {
    showToast('error', 'Upload failed: ' + err.message);
  }
}

function renderContactsTable() {
  contactsSection.style.display = 'block';
  previewCount.textContent = contacts.length;

  contactsTbody.innerHTML = contacts.map(c => `
    <tr id="contact-row-${c.id}" data-id="${c.id}">
      <td>${c.id}</td>
      <td>${c.name || '—'}</td>
      <td>${c.phone}</td>
      <td><span class="contact-status pending">Pending</span></td>
    </tr>
  `).join('');
}

function updateContactRow(contactId, status) {
  const row = $(`#contact-row-${contactId}`);
  if (!row) return;

  row.className = status === 'sending' ? 'sending' : status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : '';

  const statusCell = row.querySelector('.contact-status');
  if (statusCell) {
    const labels = { sending: 'Sending...', sent: 'Sent ✓', failed: 'Failed ✗' };
    statusCell.className = `contact-status ${status}`;
    statusCell.textContent = labels[status] || status;
  }

  // Scroll the row into view
  if (status === 'sending') {
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ─── Message Composer ─────────────────────────────────────────────────────
messageInput.addEventListener('input', () => {
  charCount.textContent = messageInput.value.length;
  checkStartButton();
});

// Variable tag buttons
$$('.btn-tag').forEach(btn => {
  btn.addEventListener('click', () => {
    const variable = btn.dataset.var;
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const text = messageInput.value;
    messageInput.value = text.substring(0, start) + variable + text.substring(end);
    messageInput.focus();
    messageInput.setSelectionRange(start + variable.length, start + variable.length);
    charCount.textContent = messageInput.value.length;
    checkStartButton();
  });
});

// ─── Image Upload ─────────────────────────────────────────────────────────

let uploadedImagePath = null;

imageInput.addEventListener('change', async () => {
  if (imageInput.files.length === 0) return;
  const file = imageInput.files[0];
  const formData = new FormData();
  formData.append('image', file);

  try {
    showToast('info', 'Uploading image...');
    const res = await fetch('/api/upload-image', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
        showToast('error', data.error || 'Failed to upload image');
        imageInput.value = '';
        return;
    }
    uploadedImagePath = data.imagePath;
    imageName.textContent = data.imageName;
    imageInfo.style.display = 'flex';
    showToast('success', 'Image attached successfully');
  } catch(err) {
    showToast('error', 'Image upload failed: ' + err.message);
    imageInput.value = '';
  }
});

btnRemoveImage.addEventListener('click', () => {
  uploadedImagePath = null;
  imageInput.value = '';
  imageInfo.style.display = 'none';
  showToast('info', 'Image removed');
});

// ─── Campaign Controls ───────────────────────────────────────────────────
function checkStartButton() {
  btnStart.disabled = !(contacts.length > 0 && messageInput.value.trim().length > 0 && !campaignRunning);
}

btnStart.addEventListener('click', startCampaign);
btnPause.addEventListener('click', pauseCampaign);
btnStop.addEventListener('click', stopCampaign);

async function startCampaign() {
  const message = messageInput.value.trim();
  if (!message || contacts.length === 0) return;

  const payload = {
    contacts,
    message,
    batchSize: parseInt($('#batch-size').value) || 3,
    minDelay: parseInt($('#min-delay').value) || 5,
    maxDelay: parseInt($('#max-delay').value) || 15,
    minBatchPause: parseInt($('#min-batch-pause').value) || 30,
    maxBatchPause: parseInt($('#max-batch-pause').value) || 90,
    countryCode: $('#country-code').value || '91',
    imagePath: uploadedImagePath
  };

  try {
    const res = await fetch('/api/start-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) {
      showToast('error', data.error);
      return;
    }

    campaignRunning = true;
    campaignPaused = false;
    btnStart.style.display = 'none';
    btnPause.style.display = 'inline-flex';
    btnStop.style.display = 'inline-flex';
    btnStart.disabled = true;

    // Reset contact statuses
    $$('#contacts-tbody tr').forEach(row => {
      row.className = '';
      row.querySelector('.contact-status').className = 'contact-status pending';
      row.querySelector('.contact-status').textContent = 'Pending';
    });

    showToast('success', `Campaign started! Sending to ${data.total} contacts`);
  } catch (err) {
    showToast('error', 'Failed to start campaign: ' + err.message);
  }
}

async function pauseCampaign() {
  try {
    const res = await fetch('/api/pause-campaign', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      campaignPaused = data.paused;
      btnPause.innerHTML = campaignPaused
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Resume`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`;
    }
  } catch (err) {
    showToast('error', err.message);
  }
}

async function stopCampaign() {
  try {
    await fetch('/api/stop-campaign', { method: 'POST' });
    campaignRunning = false;
    campaignPaused = false;
    btnStart.style.display = 'inline-flex';
    btnPause.style.display = 'none';
    btnStop.style.display = 'none';
    checkStartButton();
  } catch (err) {
    showToast('error', err.message);
  }
}

// ─── Progress Updates ─────────────────────────────────────────────────────
function updateProgress(data) {
  statTotal.textContent = data.total;
  statSent.textContent = data.sent;
  statFailed.textContent = data.failed;
  statRemaining.textContent = data.total - data.sent - data.failed;

  const percent = data.total > 0 ? Math.round((data.currentIndex / data.total) * 100) : 0;
  progressFill.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;

  if (!data.running) {
    campaignRunning = false;
    campaignPaused = false;
    btnStart.style.display = 'inline-flex';
    btnPause.style.display = 'none';
    btnStop.style.display = 'none';
    checkStartButton();
  }
}

// ─── Live Log ─────────────────────────────────────────────────────────────
function addLogEntry(type, message, timestamp) {
  const time = timestamp ? new Date(timestamp).toLocaleTimeString() : '--:--:--';

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${message}</span>`;

  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;

  // Keep max 500 entries
  while (logContainer.children.length > 500) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

btnClearLog.addEventListener('click', () => {
  logContainer.innerHTML = `
    <div class="log-entry info">
      <span class="log-time">--:--:--</span>
      <span class="log-msg">Log cleared.</span>
    </div>`;
});

// ─── Logout ───────────────────────────────────────────────────────────────
btnLogout.addEventListener('click', async () => {
  if (!confirm('Disconnect WhatsApp session?')) return;
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (err) {
    showToast('error', err.message);
  }
});

// ─── Toast Notifications ──────────────────────────────────────────────────
function showToast(type, message) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

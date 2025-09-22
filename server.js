// server.js  — Hostinger SMTP + Google Sheets + Pixel Tracking (isolated under /hostinger)
// ----------------------------------------------------------------------------------------

const express = require('express');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const fs = require('fs');
const crypto = require('crypto'); // NEW: for per-send UUID

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ---------- Health ----------
app.get('/', (_, res) => res.send('OK'));
app.get('/healthz', (_, res) => res.json({ ok: true }));

// ---------- SMTP (Hostinger) ----------
const toBool = v => /^(true|1|yes)$/i.test(String(v || ''));
const smtpPort   = Number(process.env.SMTP_PORT || 587);
const smtpSecure = toBool(process.env.SMTP_SECURE || 'false'); // true for 465, false for 587
const SMTP_AUTH_METHOD = (process.env.SMTP_AUTH_METHOD || 'LOGIN').toUpperCase();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // e.g. smtp.hostinger.com
  port: smtpPort,
  secure: smtpSecure,
  requireTLS: !smtpSecure,
  authMethod: SMTP_AUTH_METHOD,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
});

// ---------- Sheets ----------
const KEYFILE  = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'sa.json';
const SHEET_ID = process.env.SHEET_ID || process.env.SHEETS_SPREADSHEET_ID || '1jrSeqCGiu44AiIq2WP1a00ly8au0kZp5wxsBLV60OvI';
const TAB_NAME = process.env.TAB_NAME || 'VOLZA 6K FREE';

async function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function findRowByEmail(sheets, email) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A2:A`,
  });
  const rows = resp.data.values || [];
  const idx = rows.findIndex(r => (r[0] || '').trim().toLowerCase() === email.trim().toLowerCase());
  return idx >= 0 ? idx + 2 : -1; // +2 to offset header
}

// D=STATUS, E=Open Date, F=Sent Date, G=Bounce Reason
async function markStatus(email, status, reason = '') {
  try {
    const sheets = await sheetsClient();
    const row = await findRowByEmail(sheets, email);
    if (row === -1) return;
    const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi' });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!D${row}:G${row}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[status, '', now, reason]] },
    });
  } catch (e) {
    console.log('markStatus error:', e.message);
  }
}

async function markOpen(email, campaignId = '') {
  try {
    const sheets = await sheetsClient();
    const row = await findRowByEmail(sheets, email);
    if (row === -1) return;

    const get = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!D${row}:G${row}`,
    });
    const vals = get.data.values?.[0] || [];
    const curStatus = (vals[0] || '').trim();
    const openDate  = (vals[1] || '').trim();
    const sentDate  = vals[2] || '';
    const bounce    = vals[3] || '';

    const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi' });
    const nextStatus = curStatus === '' || curStatus === 'Sent' ? 'Opened' : curStatus;
    const newOpen = openDate || now;
    const tag = campaignId ? ` (id:${campaignId})` : '';
    const reasonOut = openDate ? bounce : `${bounce}${bounce ? '; ' : ''}Opened${tag}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!D${row}:G${row}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[nextStatus, newOpen, sentDate, reasonOut]] },
    });
  } catch (e) {
    console.log('markOpen error:', e.message);
  }
}

async function getRows(startRow = 2, endCol = 'G') {
  const sheets = await sheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: `${TAB_NAME}!A${startRow}:${endCol}`,
  });
  const rows = resp.data.values || [];
  return rows.map((r, i) => ({
    __row: startRow + i,
    email: (r[0] || '').trim(),
    company: r[1] || '',
    name: r[2] || '',
    status: (r[3] || '').trim(),
    openDate: r[4] || '',
    sentDate: r[5] || '',
    bounce: r[6] || '',
  }));
}

async function buildRecipientsFromSheet({ onlyIfStatusIn = ['', 'Failed'], startRow = 2, maxRows = 200 } = {}) {
  const rows = await getRows(startRow);
  const filtered = rows.filter(r => r.email && onlyIfStatusIn.includes(r.status));
  return filtered.slice(0, maxRows).map(r => ({
    email: r.email,
    name: r.name || r.company || r.email.split('@')[0],
    company: r.company,
    __row: r.__row,
  }));
}

// ---------- Helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
function applyTemplate(str, data = {}) {
  if (!str) return str;
  return str.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, k) =>
    (data[k] !== undefined && data[k] !== null) ? String(data[k]) : ''
  );
}

async function loadTemplate({ html, templateURL, filePath }) {
  if (html) return html;
  if (templateURL) {
    // Node 18+: global fetch available
    const resp = await fetch(templateURL);
    if (!resp.ok) throw new Error(`templateURL fetch failed: ${resp.status}`);
    return await resp.text();
  }
  const path = filePath || process.env.EMAIL_TEMPLATE_FILE || 'email-template.html';
  if (fs.existsSync(path)) return fs.readFileSync(path, 'utf8');
  throw new Error('No HTML template available (html/templateURL/file not found).');
}

// ---------- SEND ONE (patched with send_id + cacheBuster) ----------
async function sendOne(
  { from, replyTo, subject, html, text },
  recipient,
  { maxRetries = 1, delayOnSuccessMs = 1200 } = {}
) {
  const to = recipient.email;
  if (!isEmail(to)) return { to, ok: false, error: 'invalid_email' };

  // per-send identifiers for tracking/pixel
  const sendId = crypto.randomUUID();  // {{send_id}}
  const cacheBuster = Date.now();      // {{cacheBuster}}

  // placeholders available to template
  const ctx = { ...recipient, email: to, send_id: sendId, cacheBuster };

  const htmlRendered    = applyTemplate(html, ctx);
  const textRendered    = text ? applyTemplate(text, ctx) : undefined;
  const subjectRendered = applyTemplate(subject, ctx);

  const msg = {
    from, to,
    subject: subjectRendered,
    html: htmlRendered,
    text: textRendered,
    replyTo: replyTo || from,
  };

  let attempt = 0, lastErr = null;
  while (attempt <= maxRetries) {
    try {
      const info = await transporter.sendMail(msg);
      if (delayOnSuccessMs) await sleep(delayOnSuccessMs);
      return { to, ok: true, messageId: info.messageId, response: info.response, sendId };
    } catch (err) {
      lastErr = err?.message || String(err);
      attempt += 1;
      if (attempt > maxRetries) break;
      await sleep(800 * Math.pow(2, attempt - 1)); // backoff
    }
  }
  return { to, ok: false, error: lastErr || 'send_failed' };
}

// ---------- Debug ----------
app.get('/hostinger/env-check', async (req, res) => {
  const mask = s => (s ? s.replace(/.(?=.{3})/g, '*') : null);
  res.json({
    SMTP_HOST: process.env.SMTP_HOST || null,
    SMTP_PORT: smtpPort,
    SMTP_SECURE: smtpSecure,
    SMTP_USER: mask(process.env.SMTP_USER || null),
    SHEET_ID, TAB_NAME,
    KEYFILE_IN_USE: KEYFILE,
  });
});

app.get('/hostinger/smtp-check', async (req, res) => {
  try { await transporter.verify(); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: String(e) }); }
});

// ---------- Auth guard ----------
const BATCH_TOKEN = process.env.BATCH_TOKEN;
function guard(path) {
  app.use(path, (req, res, next) => {
    if (!BATCH_TOKEN) return next();
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    if (token === BATCH_TOKEN) return next();
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  });
}
guard('/hostinger/sheet-preview');
guard('/hostinger/send-from-sheet');

// ---------- Pixel (open tracking) ----------
function sendPixel(res) {
  const buf = Buffer.from('R0lGODlhAQABAPAAAP///wAAACwAAAAAAQABAAACAkQBADs=', 'base64'); // 1x1 transparent GIF
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.status(200).send(buf);
}

// Existing pixel under /hostinger/px
// <img src="https://YOUR_SERVER/hostinger/px?email={{email}}&id=hostinger-2025" ... />
app.get('/hostinger/px', async (req, res) => {
  const email = String(req.query.email || '').trim();
  const id    = String(req.query.id || '').trim(); // optional label
  if (email) markOpen(email, id).catch(()=>{});
  return sendPixel(res);
});

// NEW alias at /px (recommended simpler URL)
// <img src="https://YOUR_SERVER/px?email={{email}}&id={{send_id}}&cb={{cacheBuster}}" ... />
app.get('/px', async (req, res) => {
  const email = String(req.query.email || '').trim();
  const id    = String(req.query.id || '').trim(); // optional label
  if (email) markOpen(email, id).catch(()=>{});
  return sendPixel(res);
});

// ---------- Preview ----------
app.get('/hostinger/sheet-preview', async (req, res) => {
  try {
    const startRow = Number(req.query.startRow || 2);
    const maxRows  = Number(req.query.maxRows  || 50);
    const onlyIfStatusIn = (req.query.onlyIfStatusIn ?? ',').split(',').map(s => s.trim());
    const recipients = await buildRecipientsFromSheet({ onlyIfStatusIn, startRow, maxRows });
    res.json({ ok: true, count: recipients.length, sample: recipients.slice(0, 10) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Send from Sheet (Hostinger SMTP) ----------
app.post('/hostinger/send-from-sheet', async (req, res) => {
  try {
    const {
      subject = process.env.EMAIL_SUBJECT || 'Graphtect Catalogue 2025',
      html, text, templateURL, filePath,
      batchDelayMs   = Number(process.env.BATCH_DELAY_MS || 1500),
      maxRetries     = 1,
      startRow       = 2,
      maxRows        = 300, // keep under Hostinger daily cap; cron controls timing
      onlyIfStatusIn = ['', 'Failed'],
      from           = process.env.SMTP_USER,
      replyTo,
    } = req.body || {};

    if (!from || String(from).toLowerCase() !== String(process.env.SMTP_USER || '').toLowerCase()) {
      return res.status(400).json({ ok: false, error: 'from_must_equal_smtp_user' });
    }

    const tpl = await loadTemplate({ html, templateURL, filePath });

    const recipients = await buildRecipientsFromSheet({ onlyIfStatusIn, startRow, maxRows });
    if (recipients.length === 0) return res.json({ ok: true, sent: 0, total: 0, results: [] });

    const results = [];
    for (const r of recipients) {
      const result = await sendOne(
        { from, replyTo, subject, html: tpl, text },
        r,
        { maxRetries, delayOnSuccessMs: batchDelayMs }
      );
      try {
        if (result.ok) await markStatus(result.to, 'Sent', '');
        else           await markStatus(result.to, 'Failed', result.error || '');
      } catch (e) {
        console.log('Sheets status update error:', e.message);
      }
      results.push(result);
    }

    res.json({ ok: true, sent: results.filter(x => x.ok).length, total: recipients.length, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Start ----------
app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on', PORT);
});

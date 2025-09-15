// server.js
// Graphtect SMTP + Google Sheets + TemplateURL + Open Pixel (final)

const express = require('express');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------------------ */
/* Boot & health                                                      */
/* ------------------------------------------------------------------ */

app.use(express.json());
app.get('/', (_, res) => res.send('OK'));
app.get('/healthz', (_, res) => res.json({ ok: true }));

/* ------------------------------------------------------------------ */
/* Nodemailer (Hostinger)                                             */
/* ------------------------------------------------------------------ */

const toBool = (v) => /^(true|1|yes)$/i.test(String(v || ''));
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = toBool(process.env.SMTP_SECURE || 'false');
const SMTP_AUTH_METHOD = (process.env.SMTP_AUTH_METHOD || 'LOGIN').toUpperCase();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,          // smtp.hostinger.com
  port: smtpPort,                       // 465 or 587
  secure: smtpSecure,                   // true for 465, false for 587 (STARTTLS)
  requireTLS: !smtpSecure,              // force STARTTLS on 587
  authMethod: SMTP_AUTH_METHOD,         // LOGIN or PLAIN
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  logger: true,                         // turn off later if noisy
  debug: true,
});

/* ------------------------------------------------------------------ */
/* Template handling                                                  */
/* ------------------------------------------------------------------ */

const TEMPLATE_FILE = process.env.EMAIL_TEMPLATE_FILE || 'email-template.html';
const SUBJECT_TEMPLATE = process.env.EMAIL_SUBJECT || 'Graphtect Catalogue 2025';

let TEMPLATE_CACHE = null;
function loadTemplateFile() {
  try {
    TEMPLATE_CACHE = fs.readFileSync(TEMPLATE_FILE, 'utf8');
    return TEMPLATE_CACHE;
  } catch (e) {
    console.log('TEMPLATE load error:', e.message);
    return TEMPLATE_CACHE || '<p>Hello {{name}},</p>';
  }
}

function renderTemplate(str, data = {}) {
  if (!str) return '';
  return str.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, k) =>
    (data[k] !== undefined && data[k] !== null) ? String(data[k]) : ''
  );
}

// Load template from: inline html -> templateURL (HTTP/HTTPS) -> local file
async function resolveTemplate({ html, templateURL }) {
  if (html && typeof html === 'string' && html.trim()) return html;

  if (templateURL && /^https?:\/\//i.test(templateURL)) {
    try {
      // Node 18+ has global fetch
      const r = await fetch(templateURL, { cache: 'no-store' });
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const txt = await r.text();
      if (txt && txt.trim()) return txt;
    } catch (e) {
      console.log('templateURL fetch failed:', e.message);
    }
  }
  return loadTemplateFile();
}

/* ------------------------------------------------------------------ */
/* Google Sheets setup                                                */
/* ------------------------------------------------------------------ */

// If you use a Secret File in Render, set GOOGLE_APPLICATION_CREDENTIALS to that filename (e.g., "sa.json")
const KEYFILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'smtp-sheets-tracker-3504935cb6f9.json';
const SHEET_ID = '1jrSeqCGiu44AiIq2WP1a00ly8au0kZp5wxsBLV60OvI';
const TAB_NAME = 'VOLZA 6K FREE'; // match your tab name exactly

async function getSheetsClient() {
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
  const idx = rows.findIndex(r => (r[0] || '').toLowerCase().trim() === email.toLowerCase().trim());
  return idx >= 0 ? idx + 2 : -1; // +2 for header
}

// STATUS (D), Open Date (E), Sent Date (F), Bounce Reason (G)
async function markStatus(email, status, reason = '') {
  try {
    const sheets = await getSheetsClient();
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
    console.log('Sheets update error for', email, String(e));
  }
}

// Mark open when pixel fires
async function markOpen(email, campaignId = '') {
  try {
    const sheets = await getSheetsClient();
    const row = await findRowByEmail(sheets, email);
    if (row === -1) return;

    const get = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!D${row}:G${row}`
    });
    const vals = get.data.values?.[0] || [];
    const currentStatus = (vals[0] || '').trim();
    const openDate      = (vals[1] || '').trim();
    const sentDate      = vals[2] || '';
    const bounceReason  = vals[3] || '';

    const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi' });
    const nextStatus = (currentStatus === 'Sent' || currentStatus === '') ? 'Opened' : currentStatus;
    const newOpen = openDate || now;

    const tag = campaignId ? ` (id:${campaignId})` : '';
    const reasonOut = openDate ? bounceReason : `${bounceReason}${bounceReason ? '; ' : ''}Opened${tag}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!D${row}:G${row}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[nextStatus, newOpen, sentDate, reasonOut]] }
    });
  } catch (e) {
    console.log('Sheets markOpen error for', email, String(e));
  }
}

async function getSheetRows(startRow = 2, endCol = 'G') {
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A${startRow}:${endCol}`,
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
    bounce: r[6] || ''
  }));
}

async function buildRecipientsFromSheet({
  onlyIfStatusIn = ['', 'Failed'],
  startRow = 2,
  maxRows = 200
} = {}) {
  const rows = await getSheetRows(startRow);
  const filtered = rows
    .filter(r => r.email)
    .filter(r => onlyIfStatusIn.includes(r.status));
  return filtered.slice(0, maxRows).map(r => ({
    email: r.email,
    name: r.name || r.company || r.email.split('@')[0],
    company: r.company,
    __row: r.__row
  }));
}

/* ------------------------------------------------------------------ */
/* Open-tracking pixel                                                */
/* ------------------------------------------------------------------ */

const ONE_BY_ONE_GIF = Buffer.from(
  'R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64'
);

app.get('/px', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim();
    const campaignId = String(req.query.id || '').trim();
    if (email) {
      await markOpen(email, campaignId);
    }
  } catch (e) {
    // swallow; always return the pixel
  } finally {
    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': ONE_BY_ONE_GIF.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.status(200).send(ONE_BY_ONE_GIF);
  }
});

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sendOne({ from, replyTo, subject, html, text }, recipient, maxRetries, delayOnSuccessMs) {
  const to = String(recipient.email || '').trim();
  if (!isEmail(to)) return { to, ok: false, error: 'invalid_email' };

  // Render subject + html with recipient fields
  const subj = renderTemplate(subject, { ...recipient, email: to });
  const htmlRendered = renderTemplate(html, { ...recipient, email: to });
  const textRendered = text ? renderTemplate(text, { ...recipient, email: to }) : undefined;

  const msg = {
    from,
    to,
    subject: subj,
    html: htmlRendered,
    text: textRendered,
    replyTo: replyTo || from,
  };

  let attempt = 0;
  let lastErr = null;
  while (attempt <= maxRetries) {
    try {
      const info = await transporter.sendMail(msg);
      if (delayOnSuccessMs) await sleep(delayOnSuccessMs);
      return { to, ok: true, messageId: info.messageId, response: info.response };
    } catch (err) {
      lastErr = String(err && err.message ? err.message : err);
      attempt += 1;
      if (attempt > maxRetries) break;
      await sleep(800 * Math.pow(2, attempt - 1)); // 0.8s, 1.6s, 3.2s...
    }
  }
  return { to, ok: false, error: lastErr || 'send_failed' };
}

/* ------------------------------------------------------------------ */
/* Debug routes                                                       */
/* ------------------------------------------------------------------ */

app.get('/env-check', (req, res) => {
  const mask = s => (s ? s.replace(/.(?=.{3})/g, '*') : null);
  const pass = process.env.SMTP_PASS || '';
  res.json({
    SMTP_HOST: process.env.SMTP_HOST || null,
    SMTP_PORT: smtpPort,
    SMTP_SECURE_RAW: process.env.SMTP_SECURE || null,
    SMTP_SECURE_BOOL: smtpSecure,
    SMTP_USER: mask(process.env.SMTP_USER || null),
    SMTP_PASS_SET: !!pass,
    SMTP_PASS_LEN: pass.length,
    SHEET_ID,
    TAB_NAME,
    KEYFILE_IN_USE: KEYFILE,
    TEMPLATE_FILE: TEMPLATE_FILE
  });
});

app.get('/smtp-check', async (req, res) => {
  try {
    await transporter.verify();
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: String(err) });
  }
});

app.get('/send-test', async (req, res) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.SMTP_USER,
      subject: 'SMTP Test Email',
      text: 'Hello from Render (Nodemailer).',
    });
    res.json({ ok: true, info });
  } catch (err) {
    res.json({ ok: false, error: String(err) });
  }
});

/* ------------------------------------------------------------------ */
/* Auth guards (Bearer)                                               */
/* ------------------------------------------------------------------ */

const BATCH_TOKEN = process.env.BATCH_TOKEN;

function guard(path) {
  app.use(path, (req, res, next) => {
    if (!BATCH_TOKEN) return next(); // open if not configured
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    if (token === BATCH_TOKEN) return next();
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  });
}

guard('/send-batch');
guard('/send-from-sheet');
guard('/send-daily');

/* ------------------------------------------------------------------ */
/* Batch from manual list                                             */
/* ------------------------------------------------------------------ */

app.post('/send-batch', async (req, res) => {
  try {
    const {
      from = process.env.SMTP_USER,
      replyTo,
      subject = SUBJECT_TEMPLATE,
      html,                 // inline HTML (optional)
      templateURL,          // URL to template (optional)
      text = '',
      recipients = [],
      batchDelayMs = 800,
      maxRetries = 2,
    } = req.body || {};

    if (!Array.isArray(recipients) || recipients.length === 0)
      return res.status(400).json({ ok: false, error: 'no_recipients' });
    if (String(from).trim().toLowerCase() !== String(process.env.SMTP_USER || '').trim().toLowerCase())
      return res.status(400).json({ ok: false, error: 'from_must_equal_smtp_user' });

    const htmlSource = await resolveTemplate({ html, templateURL });

    const results = [];
    for (const r of recipients) {
      const result = await sendOne(
        { from, replyTo, subject, html: htmlSource, text },
        r,
        Number(maxRetries) || 0,
        Number(batchDelayMs) || 0
      );

      try {
        if (result.ok) await markStatus(result.to, 'Sent', '');
        else           await markStatus(result.to, 'Failed', result.error || '');
      } catch (e) {
        console.log('Sheets update error for', result.to, String(e));
      }

      results.push(result);
    }

    res.json({ ok: true, sent: results.filter(x => x.ok).length, total: recipients.length, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

/* ------------------------------------------------------------------ */
/* Preview from sheet                                                 */
/* ------------------------------------------------------------------ */

// GET /sheet-preview?startRow=2&maxRows=200&onlyIfStatusIn=,Failed
app.get('/sheet-preview', async (req, res) => {
  try {
    const startRow = Number(req.query.startRow || 2);
    const maxRows  = Number(req.query.maxRows  || 50);
    const onlyIfStatusIn =
      (req.query.onlyIfStatusIn ?? ',').split(',').map(s => s.trim());

    const recipients = await buildRecipientsFromSheet({ onlyIfStatusIn, startRow, maxRows });
    res.json({ ok: true, count: recipients.length, sample: recipients.slice(0, 10) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ------------------------------------------------------------------ */
/* Send directly from sheet (manual trigger)                          */
/* ------------------------------------------------------------------ */

app.post('/send-from-sheet', async (req, res) => {
  try {
    const {
      subject,
      html,
      templateURL,                 // NEW: prefer URL if provided
      text,
      batchDelayMs   = 1200,
      maxRetries     = 2,
      startRow       = 2,
      maxRows        = 200,
      onlyIfStatusIn = ['', 'Failed'],
      from           = process.env.SMTP_USER,
      replyTo
    } = req.body || {};

    if (!subject && !SUBJECT_TEMPLATE) return res.status(400).json({ ok: false, error: 'missing_subject' });

    const htmlSource   = await resolveTemplate({ html, templateURL });
    const finalSubject = subject || SUBJECT_TEMPLATE;

    if (!htmlSource) return res.status(500).json({ ok: false, error: 'template_missing' });
    if (String(from).trim().toLowerCase() !== String(process.env.SMTP_USER || '').trim().toLowerCase())
      return res.status(400).json({ ok: false, error: 'from_must_equal_smtp_user' });

    const recipients = await buildRecipientsFromSheet({ onlyIfStatusIn, startRow, maxRows });
    if (recipients.length === 0) return res.json({ ok: true, sent: 0, total: 0, results: [] });

    const results = [];
    for (const r of recipients) {
      const result = await sendOne(
        { from, replyTo, subject: finalSubject, html: htmlSource, text },
        r,
        Number(maxRetries) || 0,
        Number(batchDelayMs) || 0
      );

      try {
        if (result.ok) await markStatus(result.to, 'Sent', '');
        else           await markStatus(result.to, 'Failed', result.error || '');
      } catch (e) {
        console.log('Sheets update error for', result.to, String(e));
      }

      results.push(result);
    }

    res.json({ ok: true, sent: results.filter(x => x.ok).length, total: recipients.length, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

/* ------------------------------------------------------------------ */
/* Daily automation endpoint (for Render Cron)                        */
/* ------------------------------------------------------------------ */

app.post('/send-daily', async (req, res) => {
  try {
    const {
      maxRows        = Number(process.env.DAILY_MAX_ROWS || 350),
      batchDelayMs   = Number(process.env.DAILY_BATCH_DELAY_MS || 3000),
      onlyIfStatusIn = ['', 'Failed'],
      startRow       = 2,
      from           = process.env.SMTP_USER,
      replyTo        = process.env.SMTP_USER,
      subject,
      templateURL,
    } = req.body || {};

    const htmlSource   = await resolveTemplate({ html: null, templateURL }); // prefer URL in automation
    const finalSubject = subject || SUBJECT_TEMPLATE;
    if (!htmlSource) return res.status(500).json({ ok: false, error: 'template_missing' });

    const recipients = await buildRecipientsFromSheet({ onlyIfStatusIn, startRow, maxRows });
    if (recipients.length === 0) return res.json({ ok: true, sent: 0, total: 0, results: [] });

    const results = [];
    for (const r of recipients) {
      const result = await sendOne(
        { from, replyTo, subject: finalSubject, html: htmlSource, text: '' },
        r,
        2,
        batchDelayMs
      );
      try {
        if (result.ok) await markStatus(result.to, 'Sent', '');
        else           await markStatus(result.to, 'Failed', result.error || '');
      } catch (e) {
        console.log('Sheets update error for', result.to, String(e));
      }
      results.push(result);
    }

    res.json({ ok: true, sent: results.filter(x => x.ok).length, total: recipients.length, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ------------------------------------------------------------------ */
/* Start                                                              */
/* ------------------------------------------------------------------ */

app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on', PORT);
});

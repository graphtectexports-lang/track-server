// server.js
const express = require('express');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON for all routes
app.use(express.json());

/* ------------------------ Basic health routes ------------------------ */
app.get('/', (_, res) => res.send('OK'));
app.get('/healthz', (_, res) => res.json({ ok: true }));

/* ------------------------ Mail transporter --------------------------- */
const toBool = v => /^(true|1|yes)$/i.test(String(v || ''));
const smtpPort   = Number(process.env.SMTP_PORT || 587);
const smtpSecure = toBool(process.env.SMTP_SECURE || 'false');
const SMTP_AUTH_METHOD = (process.env.SMTP_AUTH_METHOD || 'LOGIN').toUpperCase();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,             // e.g., smtp.hostinger.com
  port: smtpPort,                          // 465 or 587
  secure: smtpSecure,                      // true for 465, false for 587
  requireTLS: !smtpSecure,                 // STARTTLS when on 587
  authMethod: SMTP_AUTH_METHOD,            // LOGIN or PLAIN
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  logger: true,                            // turn off later in prod
  debug: true,
});

/* ------------------------ Google Sheets setup ------------------------ */
// Key file must exist in the container (repo file OR Render Secret File).
// If you use a different filename, set GOOGLE_APPLICATION_CREDENTIALS to that path.
const KEYFILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'smtp-sheets-tracker-3504935cb6f9.json';

// Your Sheet ID + Tab
const SHEET_ID = '1jrSeqCGiu44AiIq2WP1a00ly8au0kZp5wxsBLV60OvI';
const TAB_NAME = 'VOLZA 6 K FREE'.replace(' 6 K ', ' 6K '); // normalize just in case

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Find row by email (column A)
async function findRowByEmail(sheets, email) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A2:A`,
  });
  const rows = resp.data.values || [];
  const idx = rows.findIndex(r => (r[0] || '').toLowerCase().trim() === email.toLowerCase().trim());
  return idx >= 0 ? idx + 2 : -1; // +2 for header offset
}

// Update STATUS / Sent Date / Bounce Reason for one email
async function markStatus(email, status, reason = '') {
  try {
    const sheets = await getSheetsClient();
    const row = await findRowByEmail(sheets, email);
    if (row === -1) return; // email not found; skip silently

    const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi' });
    // Columns: D=STATUS, E=Open Date, F=Sent Date, G=Bounce Reason
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

// Mark an email as "Opened" and log the Open Date (E)
async function markOpen(email, campaignId = '') {
  try {
    const sheets = await getSheetsClient();
    const row = await findRowByEmail(sheets, email);
    if (row === -1) return;

    // Get current values for that row (D-G)
    const get = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!D${row}:G${row}`
    });
    const vals = get.data.values?.[0] || [];
    const currentStatus = (vals[0] || '').trim(); // D
    const openDate      = (vals[1] || '').trim(); // E
    const sentDate      = vals[2] || '';          // F
    const bounceReason  = vals[3] || '';          // G

    const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi' });

    // Update status + open date only if not already set
    const nextStatus = currentStatus === 'Sent' || currentStatus === '' ? 'Opened' : currentStatus;
    const newOpen    = openDate || now;

    // Tag in Bounce Reason column for traceability
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

// Read rows starting at a given row (A..G) and return objects with row number
async function getSheetRows(startRow = 2, endCol = 'G') {
  const sheets = await getSheetsClient();
  const range = `${TAB_NAME}!A${startRow}:${endCol}`;
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range
  });

  // rows: [Email, Company, Name, STATUS, OpenDate, SentDate, Bounce]
  const rows = resp.data.values || [];
  return rows.map((r, i) => ({
    __row: startRow + i,                     // actual sheet row number
    email: (r[0] || '').trim(),
    company: r[1] || '',
    name: r[2] || '',
    status: (r[3] || '').trim(),
    openDate: r[4] || '',
    sentDate: r[5] || '',
    bounce: r[6] || ''
  }));
}

// Build recipients list filtered by STATUS and limited in size
async function buildRecipientsFromSheet({
  onlyIfStatusIn = ['', 'Failed'],          // send to blank/Failed by default
  startRow = 2,                             // start after header
  maxRows = 200
} = {}) {
  const rows = await getSheetRows(startRow);
  const filtered = rows
    .filter(r => r.email)                   // must have an email
    .filter(r => onlyIfStatusIn.includes(r.status));

  const limited = filtered.slice(0, maxRows);

  // Map to shape used by sendOne (also keep name/company for templating)
  return limited.map(r => ({
    email: r.email,
    name: r.name || r.company || r.email.split('@')[0],
    company: r.company,
    __row: r.__row
  }));
}

/* ------------------------ Small helpers ------------------------ */
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function applyTemplate(str, data = {}) {
  if (!str) return str;
  return str.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, k) =>
    (data[k] !== undefined && data[k] !== null) ? String(data[k]) : ''
  );
}

/* ------------------------ Debug routes ------------------------ */
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

/* ------------------------ Token guards ------------------------ */
const BATCH_TOKEN = process.env.BATCH_TOKEN; // set in Render to protect sending routes

app.use('/send-batch', (req, res, next) => {
  if (!BATCH_TOKEN) return next(); // open if not configured
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (token === BATCH_TOKEN) return next();
  return res.status(401).json({ ok: false, error: 'unauthorized' });
});

app.use('/send-from-sheet', (req, res, next) => {
  if (!BATCH_TOKEN) return next(); // open if not configured
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (token === BATCH_TOKEN) return next();
  return res.status(401).json({ ok: false, error: 'unauthorized' });
});

/* ------------------------ Mail send helpers ------------------------ */
async function sendOne({ from, replyTo, subject, html, text }, recipient, maxRetries, delayOnSuccessMs) {
  const to = String(recipient.email || '').trim();
  if (!isEmail(to)) return { to, ok: false, error: 'invalid_email' };

  const msg = {
    from,
    to,
    subject: applyTemplate(subject, recipient),
    html: applyTemplate(html, recipient),
    text: applyTemplate(text, recipient),
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

/* ------------------------ Batch route (manual list) ------------------------ */
app.post('/send-batch', async (req, res) => {
  try {
    const {
      from = process.env.SMTP_USER,
      replyTo,
      subject,
      html,
      text,
      recipients = [],
      batchDelayMs = 800,
      maxRetries = 2,
    } = req.body || {};

    if (!subject) return res.status(400).json({ ok: false, error: 'missing_subject' });
    if (!html && !text) return res.status(400).json({ ok: false, error: 'missing_body' });
    if (!Array.isArray(recipients) || recipients.length === 0)
      return res.status(400).json({ ok: false, error: 'no_recipients' });
    if (String(from).trim().toLowerCase() !== String(process.env.SMTP_USER || '').trim().toLowerCase())
      return res.status(400).json({ ok: false, error: 'from_must_equal_smtp_user' });

    const results = [];
    for (const r of recipients) {
      const result = await sendOne({ from, replyTo, subject, html, text }, r, Number(maxRetries) || 0, Number(batchDelayMs) || 0);

      // Update Sheet
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

/* ------------------------ Preview from Sheet (no send) --------------------- */
// GET /sheet-preview?startRow=2&maxRows=200&onlyIfStatusIn=,Failed
app.get('/sheet-preview', async (req, res) => {
  try {
    const startRow = Number(req.query.startRow || 2);
    const maxRows  = Number(req.query.maxRows  || 50);
    const onlyIfStatusIn =
      (req.query.onlyIfStatusIn ?? ',') // default: "",Failed
        .split(',')
        .map(s => s.trim());
    const recipients = await buildRecipientsFromSheet({ onlyIfStatusIn, startRow, maxRows });
    res.json({ ok: true, count: recipients.length, sample: recipients.slice(0, 10) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ------------------------ Send directly from Sheet ------------------------ */
// POST /send-from-sheet   (Authorization: Bearer <BATCH_TOKEN>)
app.post('/send-from-sheet', async (req, res) => {
  try {
    const {
      subject,
      html,
      text,
      batchDelayMs   = 1200,            // pacing between sends
      maxRetries     = 2,               // per-email retries
      startRow       = 2,               // skip header
      maxRows        = 200,             // how many rows to process
      onlyIfStatusIn = ['', 'Failed'],  // blank or Failed by default
      from           = process.env.SMTP_USER,
      replyTo
    } = req.body || {};

    if (!subject) return res.status(400).json({ ok: false, error: 'missing_subject' });
    if (!html && !text) return res.status(400).json({ ok: false, error: 'missing_body' });
    if (String(from).trim().toLowerCase() !== String(process.env.SMTP_USER || '').trim().toLowerCase())
      return res.status(400).json({ ok: false, error: 'from_must_equal_smtp_user' });

    // Pull recipients from the sheet
    const recipients = await buildRecipientsFromSheet({ onlyIfStatusIn, startRow, maxRows });
    if (recipients.length === 0)
      return res.json({ ok: true, sent: 0, total: 0, results: [] });

    const results = [];
    for (const r of recipients) {
      const result = await sendOne(
        { from, replyTo, subject, html, text },
        r,
        Number(maxRetries) || 0,
        Number(batchDelayMs) || 0
      );

      // Update Sheet
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

/* ------------------------ Start server ------------------------ */
app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on', PORT);
});


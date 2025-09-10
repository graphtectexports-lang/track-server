const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// --- basic health routes ---
app.get('/', (_, res) => res.send('OK'));
app.get('/healthz', (_, res) => res.json({ ok: true }));

// --- Nodemailer transporter ---
const toBool = v => /^(true|1|yes)$/i.test(String(v || ''));
const smtpPort   = Number(process.env.SMTP_PORT || 587);
const smtpSecure = toBool(process.env.SMTP_SECURE || 'false');
const SMTP_AUTH_METHOD = (process.env.SMTP_AUTH_METHOD || 'LOGIN').toUpperCase();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,         // smtp.hostinger.com
  port: smtpPort,                      // 465 or 587
  secure: smtpSecure,                  // true for 465, false for 587
  requireTLS: !smtpSecure,             // STARTTLS when on 587
  authMethod: SMTP_AUTH_METHOD,        // LOGIN or PLAIN
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,       // no fallback/masking
  },
  tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  logger: true,
  debug: true,
});

// --- Utilities ---
app.use(express.json());

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

function applyTemplate(str, data = {}) {
  if (!str) return str;
  return str.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, k) =>
    (data[k] !== undefined && data[k] !== null) ? String(data[k]) : ''
  );
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- Routes ---
// peek at env values (safe)
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
  });
});

// verify SMTP login
app.get('/smtp-check', async (req, res) => {
  try {
    await transporter.verify();
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: String(err) });
  }
});

// send one test email
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

// send batch emails
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
      await sleep(800 * Math.pow(2, attempt - 1));
    }
  }
  return { to, ok: false, error: lastErr || 'send_failed' };
}

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
      results.push(
        await sendOne({ from, replyTo, subject, html, text }, r, Number(maxRetries) || 0, Number(batchDelayMs) || 0)
      );
    }

    res.json({ ok: true, sent: results.filter(x => x.ok).length, total: recipients.length, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// --- start server ---
app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on', PORT);
});

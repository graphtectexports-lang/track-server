const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// simple health endpoints
app.get('/', (_, res) => res.send('OK'));
app.get('/healthz', (_, res) => res.json({ ok: true }));

// --- SMTP transporter ---
const smtpPort   = Number(process.env.SMTP_PORT || 587);
const smtpSecure = /^(true|1|yes)$/i.test(process.env.SMTP_SECURE || "false");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,          // smtp.hostinger.com
  port: smtpPort,                       // 465 or 587
  secure: smtpSecure,                   // true for 465, false for 587
  requireTLS: !smtpSecure,              // force STARTTLS on 587
  authMethod: 'LOGIN',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,        // <-- raw env (no masking!)
  },
  tls: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
  },
  logger: true,
  debug: true,
});

// --- test routes ---
app.get('/env-check', (req, res) => {
  const mask = (s) => (s ? s.replace(/.(?=.{3})/g, '*') : null);
  const pass = process.env.SMTP_PASS || '';
  res.json({
    SMTP_HOST: process.env.SMTP_HOST || null,
    SMTP_PORT: smtpPort,
    SMTP_SECURE_RAW: process.env.SMTP_SECURE || null,
    SMTP_SECURE_BOOL: smtpSecure,
    SMTP_USER: mask(process.env.SMTP_USER || null),
    SMTP_PASS_SET: !!pass,
    SMTP_PASS_LEN: pass.length,         // length only, no secret exposure
  });
});

app.get('/smtp-check', async (req, res) => {
  try {
    await transporter.verify();         // tests connect + AUTH
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: String(err) });
  }
});

app.get('/send-test', async (req, res) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_USER,      // must match authenticated user
      to: process.env.SMTP_USER,
      subject: 'SMTP Test Email',
      text: 'Hello from Render (Nodemailer).',
    });
    res.json({ ok: true, info });
  } catch (err) {
    res.json({ ok: false, error: String(err) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

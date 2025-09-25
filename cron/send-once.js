// cron/send-once.js
const token = process.env.BATCH_TOKEN || '';
if (!token) { console.error('Missing BATCH_TOKEN'); process.exit(1); }

const SUBJECT   = process.env.SUBJECT   || 'New Jacket Collection - Ready for 2025 Season';
const START_ROW = +(process.env.START_ROW || 2);
const MAX_ROWS  = +(process.env.MAX_ROWS  || 1);
const SHEET_TAB = process.env.SHEET_TAB || '';

const BASE_URL  = process.env.BASE_URL || 'https://track-server-una9.onrender.com';
const url = `${BASE_URL.replace(/\/+$/,'')}/hostinger/send-from-sheet?cb=${Date.now()}`;

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'graphtect-cron/1.0',
};

const body = {
  startRow: START_ROW,
  maxRows:  MAX_ROWS,
  onlyIfStatusIn: [''], // pick blanks only (skip Sent and Failed)
  subject: SUBJECT,
  batchDelayMinMs: 5000,
  batchDelayMaxMs: 7000,
};
if (SHEET_TAB) body.sheetTab = SHEET_TAB;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// optional: 2-minute max jitter (since cron runs every 5m)
const JITTER_MAX_MS = 120_000;

// optional: fetch timeout (e.g., 45s)
async function timedFetch(resource, options = {}, timeoutMs = 45_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('client-timeout')), timeoutMs);
  try {
    return await fetch(resource, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  const pre = Math.floor(Math.random() * JITTER_MAX_MS);
  await sleep(pre);

  try {
    const r = await timedFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const txt = await r.text();
    console.log('HTTP', r.status, txt);

    if (r.status === 429) process.exit(0);   // soft-pass
    if (r.ok)           process.exit(0);     // success (even if a recipient timed out)

    if (r.status === 401) {
      console.error('Unauthorized token');
      process.exit(1);
    }

    if (r.status >= 500) {
      await sleep(5000);
      const r2 = await timedFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      console.log('HTTP', r2.status, await r2.text());
      if (r2.status === 429) process.exit(0);
      process.exit(r2.ok ? 0 : 1);
    }

    process.exit(1);
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
})();

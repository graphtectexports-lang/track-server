// cron/send-once.js

const token = process.env.BATCH_TOKEN || '';
if (!token) {
  console.error('Missing BATCH_TOKEN');
  process.exit(1);
}

// Optional envs
const SUBJECT   = process.env.SUBJECT   || 'New Jacket Collection - Ready for 2025 Season';
const START_ROW = +(process.env.START_ROW || 2);
const MAX_ROWS  = +(process.env.MAX_ROWS  || 1);
// If you want to drive a specific sheet tab (e.g. "VOLZA 6K FREE"),
// set SHEET_TAB in the cron's Environment tab.
const SHEET_TAB = process.env.SHEET_TAB || '';

// Default to your Render service URL; override with BASE_URL if you like.
const BASE_URL  = process.env.BASE_URL ||
  'https://track-server-una9.onrender.com';

const url = `${BASE_URL.replace(/\/+$/,'')}/hostinger/send-from-sheet?cb=${Date.now()}`;

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'graphtect-cron/1.0',
};

// Build the request body
const body = {
  startRow: START_ROW,
  maxRows:  MAX_ROWS,

  // ⛔️ IMPORTANT: skip rows marked "Failed" — only pick blank STATUS
  onlyIfStatusIn: [''],

  subject: SUBJECT,
  batchDelayMinMs: 5000,
  batchDelayMaxMs: 7000,
};

// Only include sheetTab if provided (server will ignore unknown fields)
if (SHEET_TAB) body.sheetTab = SHEET_TAB;

// simple sleep helper
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // jitter up to 10 minutes so multiple crons don't pile up
  const pre = Math.floor(Math.random() * 600_000);
  await sleep(pre);

  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const txt = await r.text();
    console.log('HTTP', r.status, txt);

    // Rate-limited? don't mark the job failed (it will try again next slot)
    if (r.status === 429) process.exit(0);

    // Success (even if a particular recipient timed out on SMTP)
    if (r.ok) process.exit(0);

    if (r.status === 401) {
      console.error('Unauthorized token');
      process.exit(1);
    }

    // One gentle retry only for 5xx from the app
    if (r.status >= 500) {
      await sleep(5000);
      const r2 = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      console.log('HTTP', r2.status, await r2.text());
      if (r2.status === 429) process.exit(0);
      process.exit(r2.ok ? 0 : 1);
    }

    // Anything else: fail
    process.exit(1);
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
})();

// cron/send-once.js

const t = process.env.BATCH_TOKEN || "";
if (!t) { console.error("Missing BATCH_TOKEN"); process.exit(1); }

const SUBJECT   = process.env.SUBJECT   || "New Jacket Collection - Ready for 2025 Season";
const START_ROW = +(process.env.START_ROW || 2);
const MAX_ROWS  = +(process.env.MAX_ROWS  || 1);
const SHEET_TAB = process.env.SHEET_TAB || ""; // optional

// Use the onrender.com URL or your primary; both work, but we'll warm it up first.
const BASE_URL = (process.env.BASE_URL || "https://track.graphtectsports.com.pk").replace(/\/+$/,"");
const SEND_URL = `${BASE_URL}/hostinger/send-from-sheet?cb=${Date.now()}`;
const HEALTH_URL = `${BASE_URL}/healthz`;

const headers = {
  Authorization: `Bearer ${t}`,
  "Content-Type": "application/json",
  "User-Agent": "graphtect-cron/1.0",
};

// request body: skip Failed; send only blank STATUS
const body = {
  startRow: START_ROW,
  maxRows:  MAX_ROWS,
  onlyIfStatusIn: [""],
  subject: SUBJECT,
  batchDelayMinMs: 5000,
  batchDelayMaxMs: 7000,
};
if (SHEET_TAB) body.sheetTab = SHEET_TAB;

// helpers
const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = async (p, ms) => {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try { return await p(ac.signal); }
  finally { clearTimeout(id); }
};

// warm-up the web service (handles Render Free cold start)
async function warmUp() {
  const maxWaitMs = 180000; // up to 3 minutes
  const stepMs = 5000;
  const started = Date.now();
  while (true) {
    try {
      const res = await withTimeout((signal) =>
        fetch(HEALTH_URL, { signal }), 20000); // 20s per attempt
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        console.log("Warmup OK", j);
        return true;
      }
      console.log("Warmup non-200", res.status);
    } catch (e) {
      console.log("Warmup try failed:", String(e));
    }
    if (Date.now() - started > maxWaitMs) {
      console.log("Warmup timed out after ~3m; proceeding anyway");
      return false;
    }
    await sleep(stepMs);
  }
}

(async () => {
  try {
    await warmUp();

    // long timeout for the actual send (because sending can take time)
    const res = await withTimeout((signal) =>
      fetch(SEND_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      }), 240000 /* 4 minutes */
    );
    const txt = await res.text();
    console.log("HTTP", res.status, txt);

    if (res.status === 429) process.exit(0);      // soft-pass
    if (res.ok)              process.exit(0);
    if (res.status === 401) {
      console.error("Unauthorized token");
      process.exit(1);
    }
    // Any other status: fail
    process.exit(1);
  } catch (e) {
    const msg = String(e || "");
    console.error(msg);
    // If the request itself timed out or was aborted, treat as soft-pass so the next slot can retry.
    if (/abort|timed\s*out|timeout|client-timeout/i.test(msg)) process.exit(0);
    process.exit(1);
  }
})();

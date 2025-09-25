// cron/send-once.js

// ---------- Config via env (with sensible defaults) ----------
const {
  BATCH_TOKEN = "",
  SUBJECT = "New Jacket Collection - Ready for 2025 Season",
  HOST_URL = "https://track-server-una9.onrender.com/hostinger/send-from-sheet",
  START_ROW = "2",
  MAX_ROWS = "1",
  // pipe-separated; default = ['', 'Failed']
  ONLY_IF_STATUS_IN = "|Failed",
} = process.env;

if (!BATCH_TOKEN) {
  console.error("Missing BATCH_TOKEN");
  process.exit(1);
}

// Build request body
const body = {
  startRow: Number(START_ROW) || 2,
  maxRows: Number(MAX_ROWS) || 1,
  onlyIfStatusIn: ONLY_IF_STATUS_IN.split("|").map((s) => s.trim()), // e.g. "", "Failed"
  subject: SUBJECT,
  batchDelayMinMs: 5000,
  batchDelayMaxMs: 7000,
};

const url = `${HOST_URL}?cb=${Date.now()}`;
const headers = {
  Authorization: `Bearer ${BATCH_TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "graphtect-cron/1.0",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // up to 10 minutes of jitter to avoid minute-level hot spots
  const preJitterMs = Math.floor(Math.random() * 600_000);
  await sleep(preJitterMs);

  try {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const txt = await r.text();
    console.log("HTTP", r.status, txt);

    // Treat rate limiting as a soft success (don't mark the run failed)
    if (r.status === 429) process.exit(0);

    // On HTTP 200–299 consider it a success even if a recipient timed out
    if (r.ok) process.exit(0);

    if (r.status === 401) {
      console.error("Unauthorized token");
      process.exit(1);
    }

    // One gentle retry for 5xx
    if (r.status >= 500) {
      await sleep(5000);
      const r2 = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      console.log("HTTP", r2.status, await r2.text());
      if (r2.status === 429) process.exit(0);
      process.exit(r2.ok ? 0 : 1);
    }

    // Anything else is a hard failure
    process.exit(1);
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
})();

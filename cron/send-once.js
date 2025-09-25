const t = process.env.BATCH_TOKEN || '';
if (!t) { console.error('Missing BATCH_TOKEN'); process.exit(1); }

const body = {
  startRow: 2,
  maxRows: 1,
  onlyIfStatusIn: ["", "Failed"],
  subject: process.env.SUBJECT || "New Jacket Collection - Ready for 2025 Season",
  batchDelayMinMs: 5000,
  batchDelayMaxMs: 7000
};

const url = "https://track.graphtectsports.com.pk/hostinger/send-from-sheet?cb=" + Date.now();
const headers = {
  Authorization: "Bearer " + t,
  "Content-Type": "application/json",
  "User-Agent": "graphtect-cron/1.0"
};

(async () => {
  try {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const txt = await r.text();
    console.log("HTTP", r.status, txt);
    if (r.status === 429) process.exit(0);       // soft-pass to avoid “failed” run
    if (r.ok)               process.exit(0);     // success (even if recipient timed out)
    if (r.status === 401) { console.error("Unauthorized token"); process.exit(1); }
    process.exit(1);
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
})();

// cron/send-once.js
// One-shot sender for Render Cron

/* env you can set in Render:
   BATCH_TOKEN   (required)
   SUBJECT       (optional) overrides default subject
   HOST_URL      (optional) overrides default API host
   START_ROW     (optional) default 2
   MAX_ROWS      (optional) default 1
*/

const token = process.env.BATCH_TOKEN || "";
if (!token) {
  console.error("Missing BATCH_TOKEN");
  process.exit(1);
}

const host =
  process.env.HOST_URL ||
  "https://track-server-una9.onrender.com/hostinger/send-from-sheet";

const body = {
  startRow: Number(process.env.START_ROW || 2),
  maxRows: Number(process.env.MAX_ROWS || 1),
  onlyIfStatusIn: ["", "Failed"],
  subject: process.env.SUBJECT || "New Jacket Collection - Ready for 2025 Season",
  batchDelayMinMs: 5000,
  batchDelayMaxMs: 7000,
};

const headers = {
  Authorization: "Bearer " + token,
  "Content-Type": "application/json",
  "User-Agent": "graphtect-cron/1.0",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // jitter up to 10 minutes so our run doesn’t collide with others at :00/:30
  const jitterMs = Math.floor(Math.random() * 600_000);
  await sleep(jitterMs);

  const url = `${host}?cb=${Date.now()}`;

  try {
    const r1 = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const txt1 = await r1.text();
    console.log("HTTP", r1.status, txt1);

    // Treat rate limit as a soft success so the cron run doesn’t show failed.
    if (r1.status === 429) {
      console.log("Soft-pass on 429");
      process.exit(0);
    }

    // If request itself succeeded (even if the API reports a recipient timeout),
    // we still consider the cron run successful.
    if (r1.ok) process.exit(0);

    // Hard failure only for clear auth problems.
    if (r1.status === 401) {
      console.error("Unauthorized token");
      process.exit(1);
    }

    // Gentle one-time retry for transient 5xx.
    if (r1.status >= 500) {
      await sleep(5000);
      const r2 = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const txt2 = await r2.text();
      console.log("HTTP", r2.status, txt2);
      if (r2.status === 429) process.exit(0);
      process.exit(r2.ok ? 0 : 1);
    }

    // Anything else: mark as failed so we notice unexpected states.
    process.exit(1);
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
})();

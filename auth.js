// auth.js
const { google } = require("googleapis");

// Option A: from Render Secret file
let sa = null;
try {
  sa = require("/etc/secrets/sa.json");
} catch {
  sa = null;
}

function sheetsClient() {
  // Prefer Secret JSON if present; else fall back to env
  const email =
    (sa && sa.client_email) ||
    process.env.GOOGLE_SERVICE_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL;

  let key =
    (sa && sa.private_key) ||
    (process.env.GOOGLE_PRIVATE_KEY || "");

  if (!email || !key) {
    throw new Error("Google service account creds missing (email/key).");
  }

  // normalise newlines
  if (typeof key === "string" && key.includes("\\n")) key = key.replace(/\\n/g, "\n");
  key = key.replace(/\r/g, "");

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

module.exports = { sheetsClient };

// auth.js - Google Sheets authentication helper

const { google } = require("googleapis");
const fs = require("fs");

// If you are using Render secret file (/etc/secrets/sa.json)
function sheetsClient() {
  let creds;
  try {
    creds = JSON.parse(fs.readFileSync("/etc/secrets/sa.json", "utf-8"));
  } catch (e) {
    throw new Error("❌ Could not read service account file: " + e.message);
  }

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, "\n").replace(/\r/g, ""),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

module.exports = { sheetsClient };

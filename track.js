const express = require("express");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const app = express();
const PORT = 3000;

// ✅ Google Sheets Auth
const keys = require("./smtp-sheets-tracker-3504935cb6f9.json");

const auth = new google.auth.GoogleAuth({
  credentials: keys,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = "1jrSeqCGiu44AiIq2WP1a00ly8au0kZp5wxsBLV60OvI";
const RANGE = "VOLZA 6K FREE!A2:H";

// ✅ 1x1 pixel image
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgT1NO4UAAAAASUVORK5CYII=",
  "base64"
);

app.get("/track", async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).send("Missing email");

  const now = new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" });
  console.log(`📬 Logged open for ${email} at ${now}`);

  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    // Read rows from sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values;
    const rowIndex = rows.findIndex((row) => row[0] === email);

    if (rowIndex === -1) {
      console.log(`❌ Email ${email} not found in sheet.`);
    } else {
      const openDateRange = `VOLZA 6K FREE!E${rowIndex + 2}`; // +2 for header
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: openDateRange,
        valueInputOption: "RAW",
        requestBody: {
          values: [[now]],
        },
      });

      console.log(`✅ Sheet updated: ${openDateRange} = ${now}`);
    }
  } catch (err) {
    console.error("❌ Error updating sheet:", err.message);
  }

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", pixel.length);
  res.end(pixel);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Tracker running on http://0.0.0.0:${PORT}/track?email=example@email.com`);
});


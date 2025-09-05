// track.js — router that logs opens to Google Sheets
const express = require("express");
const router = express.Router();
const { sheetsClient } = require("./auth");

const SPREADSHEET_ID = process.env.SHEETS_SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "VOLZA 6K FREE";

// tiny 1x1 PNG (transparent)
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2rYvEAAAAASUVORK5CYII=",
  "base64"
);

function sendPixel(res) {
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res.status(200).send(PIXEL);
}

// GET /px?email=...&id=...
router.get("/px", async (req, res) => {
  try {
    const emailRaw = String(req.query.email || "").trim();
    const id = String(req.query.id || "").trim();

    if (!emailRaw) {
      // no email provided, just return pixel
      return sendPixel(res);
    }

    const email = emailRaw.toLowerCase();
    const sheets = sheetsClient();

    // read column A (emails) to find the row
    const { data: { values = [] } = {} } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:A`,
    });

    const rowOffset = 2; // because we started at A2
    const idx = values.findIndex(
      r => (r?.[0] || "").trim().toLowerCase() === email
    );

    if (idx !== -1) {
      const excelRow = idx + rowOffset;
      const now = new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" });

      const data = [
        { range: `${SHEET_NAME}!D${excelRow}`, values: [["Opened"]] }, // STATUS
        { range: `${SHEET_NAME}!E${excelRow}`, values: [[now]] },       // Open Date
      ];
      if (id) {
        data.push({ range: `${SHEET_NAME}!H${excelRow}`, values: [[id]] }); // Send ID
      }

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { valueInputOption: "RAW", data },
      });

      console.log(`✅ Logged open for ${emailRaw} at row ${excelRow}`);
    } else {
      console.log(`⚠️ Email not found in sheet: ${emailRaw}`);
    }
  } catch (err) {
    console.error("❌ /px error:", err.message);
  }
  // always return the pixel
  return sendPixel(res);
});

module.exports = router;

// track.js
const express = require("express");
const { sheetsClient } = require("./auth");

const router = express.Router();

const SPREADSHEET_ID = process.env.SHEETS_SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "VOLZA 6K FREE";

// health for this router (optional)
router.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));

/**
 * 1×1 tracking pixel
 * GET /px?email=foo@bar.com&id=optionalSendId
 */
router.get("/px", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim();
    const sendId = String(req.query.id || "").trim();

    // Always return a pixel, even if missing email
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2rYvEAAAAASUVORK5CYII=",
      "base64"
    );
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

    if (!email || !SPREADSHEET_ID) return res.status(200).send(pixel);

    const sheets = sheetsClient();

    // Read column A (emails) to locate the row
    const { data: { values = [] } = {} } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:A`,
    });

    const rowOffset = 2;
    const idx = values.findIndex(
      r => (r[0] || "").trim().toLowerCase() === email.toLowerCase()
    );

    const now = new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" });

    if (idx !== -1) {
      const row = idx + rowOffset;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            { range: `${SHEET_NAME}!D${row}`, values: [["Opened"]] }, // STATUS
            { range: `${SHEET_NAME}!E${row}`, values: [[now]] },       // Open Date
            ...(sendId ? [{ range: `${SHEET_NAME}!H${row}`, values: [[sendId]] }] : []), // Send ID
          ],
        },
      });
      console.log(`PX logged: ${email} → row ${row}`);
    } else {
      // Email not found – append a new line so you still capture opens
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:H`,
        valueInputOption: "RAW",
        requestBody: { values: [[email, "", "", "Opened", now, "", "", sendId]] },
      });
      console.log(`PX appended (not found in list): ${email}`);
    }

    return res.status(200).send(pixel);
  } catch (err) {
    console.error("PX error:", err.message);
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2rYvEAAAAASUVORK5CYII=",
      "base64"
    );
    return res.status(200).send(pixel);
  }
});

module.exports = router;

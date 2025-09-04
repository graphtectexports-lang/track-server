const SPREADSHEET_ID = process.env.SHEETS_SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "VOLZA 6K FREE";

// --- EMAIL OPEN TRACKING PIXEL ---
app.get("/px", async (req, res) => {
  try {
    const { email, id } = req.query;
    if (!email) return res.status(400).send("missing email");

    console.log(`📩 Open detected for: ${email}`);

    // Reuse your existing Google Sheets client factory
    const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_EMAIL,
      key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    // 1) Read column A (emails) to locate the row for this email
    const { data: { values = [] } = {} } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:A`,
    });

    const rowOffset = 2;
    const idx = values.findIndex(
      r => (r[0] || "").trim().toLowerCase() === String(email).trim().toLowerCase()
    );

    if (idx !== -1) {
      const excelRow = idx + rowOffset;
      const now = new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" });

      console.log(`📝 Writing open to row ${excelRow} in ${SHEET_NAME}`);

      // 2) Update STATUS (D), Open Date (E), and optionally Send ID (H)
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: [
            { range: `${SHEET_NAME}!D${excelRow}`, values: [["Opened"]] },
            { range: `${SHEET_NAME}!E${excelRow}`, values: [[now]] },
            ...(id ? [{ range: `${SHEET_NAME}!H${excelRow}`, values: [[id]] }] : []),
          ],
        },
      });

      console.log(`✅ Logged open for ${email} at row ${excelRow}`);
    } else {
      console.log(`⚠️ Email not found in sheet: ${email}`);
    }

    // Always return a 1x1 transparent PNG
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9mR7FQAAAABJRU5ErkJggg==",
      "base64"
    );
    res.set("Content-Type", "image/png").send(pixel);
  } catch (err) {
    console.error("❌ /px error:", err);

    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9mR7FQAAAABJRU5ErkJggg==",
      "base64"
    );
    res.set("Content-Type", "image/png").send(pixel);
  }
});

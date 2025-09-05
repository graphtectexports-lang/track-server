// server.js — HTTP server for tracking + optional sending

// 1) Basics
const express = require("express");
const path = require("path");
const fs = require("fs");
const { sheetsClient } = require("./auth");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());
app.use(require("./track"));

// 2) Config from ENV
const PORT = process.env.PORT || 10000;
const SHEET_NAME = process.env.SHEET_NAME || "VOLZA 6K FREE";
const SPREADSHEET_ID = process.env.SHEETS_SPREADSHEET_ID;

// Mail (optional: only needed for /send-batch)
const SMTP_HOST = process.env.SMTP_HOST || "smtp.hostinger.com";
const SMTP_PORT = +(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false") === "true";
const SMTP_USER = process.env.SMTP_USER || "export@graphtectsports.com.pk";
const SMTP_PASS = process.env.SMTP_PASS || "";

// 3) Google Sheets client from ENV (no JSON file on disk)
function sheetsClient() {
  const email = process.env.GOOGLE_SERVICE_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
  if (!email) throw new Error("Missing GOOGLE_SERVICE_EMAIL or GOOGLE_CLIENT_EMAIL");

  let key = process.env.GOOGLE_PRIVATE_KEY || "";
  if (key.includes("\\n")) key = key.replace(/\\n/g, "\n"); // convert \n into real newlines
  key = key.replace(/\r/g, ""); // strip CRs (Windows)

  if (!key) throw new Error("Missing GOOGLE_PRIVATE_KEY");

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}


// 4) Health
app.get("/", (_req, res) => res.type("text/plain").send("OK"));



// 6) OPTIONAL: batch sender via HTTP (POST /send-batch)
// Reads the sheet and sends up to MAX_PER request body (or default 10)
app.post("/send-batch", async (req, res) => {
  try {
    const MAX_SEND = Number(process.env.MAX_SEND_PER_DAY || 10);
    const DELAY_MS = Number(process.env.SEND_DELAY_MS || 30000);

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const htmlTemplate = fs.readFileSync(path.join(__dirname, "email-template.html"), "utf-8");
    const sheets = sheetsClient();

    const range = `${SHEET_NAME}!A2:H`;
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
    const rows = resp.data.values || [];

    const queue = rows
      .filter(r => r[0] && r[3] !== "Sent")
      .slice(0, MAX_SEND)
      .map(r => ({ email: r[0], name: r[2] || "Customer" }));

    for (const person of queue) {
      const customizedHtml = htmlTemplate
        .replace(/{{\s*first_name\s*}}/gi, person.name)
        .replace(/{{\s*email\s*}}/gi, person.email);

      await transporter.sendMail({
        from: `"Graphtect Sports" <${SMTP_USER}>`,
        to: person.email,
        replyTo: SMTP_USER,
        subject: `New Product Catalogue Just For You, ${person.name}!`,
        text: `Hello ${person.name},\n\nCheck out our new product catalogue here: https://graphtectsports.com.pk/product-catalogue-pdf/`,
        html: customizedHtml,
        headers: { "X-Campaign-Name": "Product-Catalogue-Launch" },
        messageId: `<graphtect-${person.email.replace(/[^a-z0-9]/gi, "")}@graphtectsports.com.pk>`,
      });

      const rowIndex = rows.findIndex(r => r[0] === person.email) + 2;
      const sentDate = new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" });

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          data: [
            { range: `${SHEET_NAME}!D${rowIndex}`, values: [["Sent"]] },
            { range: `${SHEET_NAME}!F${rowIndex}`, values: [[sentDate]] },
          ],
          valueInputOption: "RAW",
        },
      });

      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    return res.json({ ok: true, sent: queue.length });
  } catch (err) {
    console.error("send-batch error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// 7) Start server
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));



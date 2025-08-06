// ✅ STEP 1: Delay Helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ STEP 2: Required Modules
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const keys = require("./smtp-sheets-tracker-3504935cb6f9.json");

// ✅ STEP 3: Google Sheets Setup
const auth = new google.auth.GoogleAuth({
  credentials: keys,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = "1jrSeqCGiu44AiIq2WP1a00ly8au0kZp5wxsBLV60OvI";
const RANGE = "VOLZA 6K FREE!A2:H"; // Columns: Email, Company, Name, STATUS, Open Date, Sent Date, Bounce Reason, Send ID

// ✅ STEP 4: Limits
const MAX_SEND_PER_DAY = 10;
const DELAY_BETWEEN_EMAILS_MS = 30000; // 30 seconds

// ✅ STEP 5: Log File Setup
const logFile = path.join(__dirname, "send-log.json");
let sendLog = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, "utf-8")) : [];

const now = Date.now();
sendLog = sendLog.filter(entry => now - entry.timestamp < 24 * 60 * 60 * 1000);
if (sendLog.length >= MAX_SEND_PER_DAY) {
  console.log(`🚫 Limit reached: Already sent ${sendLog.length} emails in last 24 hours.`);
  process.exit(1);
}

// ✅ STEP 6: HTML Template
const htmlTemplate = fs.readFileSync(path.join(__dirname, "email-template.html"), "utf-8");

// ✅ STEP 7: Mail Transport
let transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  auth: {
    user: "export@graphtectsports.com.pk",
    pass: "Graphtect-2025",
  },
});

// ✅ STEP 8: Main Function
(async () => {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) {
    console.log("No data found in sheet.");
    return;
  }

  const recipients = rows
    .filter(row => row[0] && row[3] !== "Sent") // Email exists and STATUS not Sent
    .slice(0, MAX_SEND_PER_DAY - sendLog.length) // Enforce limit
    .map(row => ({ email: row[0], name: row[2] || "Customer" }));

  for (const person of recipients) {
    const customizedHtml = htmlTemplate
  .replace(/{{\s*first_name\s*}}/gi, person.name)
  .replace(/{{\s*email\s*}}/gi, person.email);


    let mailOptions = {
      from: '"Graphtect Sports" <export@graphtectsports.com.pk>',
      to: person.email,
      replyTo: 'export@graphtectsports.com.pk',
      subject: `New Product Catalogue Just For You, ${person.name}!`,
      text: `Hello ${person.name},\n\nCheck out our new product catalogue here: https://graphtectsports.com.pk/product-catalogue-pdf/`,
      html: customizedHtml,
      headers: {
        'X-Campaign-Name': 'Product-Catalogue-Launch',
        'List-Unsubscribe': '<mailto:export@graphtectsports.com.pk>'
      },
      messageId: `<graphtect-${person.email.replace(/[^a-z0-9]/gi, '')}@graphtectsports.com.pk>`
    };

    console.log(`\n📤 Sending to ${person.email}...`);
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ Sent: ${info.messageId}`);

      // ✅ Update sheet with status
      const rowIndex = rows.findIndex(r => r[0] === person.email) + 2; // +2 for header and 1-based indexing
const sentDate = new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" });

console.log(`📌 Updating sheet row ${rowIndex} for ${person.email}`);
await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: SPREADSHEET_ID,
  requestBody: {
    data: [
      {
        range: `VOLZA 6K FREE!D${rowIndex}`, // STATUS column
        values: [["Sent"]]
      },
      {
        range: `VOLZA 6K FREE!F${rowIndex}`, // Sent Date column
        values: [[sentDate]]
      }
    ],
    valueInputOption: "RAW"
  }
});


      // ✅ Update log
      sendLog.push({ email: person.email, timestamp: Date.now() });
      fs.writeFileSync(logFile, JSON.stringify(sendLog, null, 2));

    } catch (error) {
      console.error(`❌ Failed to send to ${person.email}:`, error.message);
    }

    await sleep(DELAY_BETWEEN_EMAILS_MS);
  }

  console.log("✅ All done.");
})();

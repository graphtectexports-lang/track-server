const { google } = require('googleapis');
const keys = require('./smtp-sheets-tracker-3504935cb6f9.json'); // Adjust filename if needed

const auth = new google.auth.GoogleAuth({
  credentials: keys,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function getSheetValues() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const spreadsheetId = '1jrSeqCGiu44AiIq2WP1a00ly8au0kZp5wxsBLV60OvI';
  const range = 'VOLZA 6K FREE!A2:H';

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  console.log('📄 Sheet Data:');
  console.log(response.data.values);
}

getSheetValues().catch(console.error);

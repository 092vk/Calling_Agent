require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const {google} = require('googleapis');
const fs = require('fs');
const fetch = require("node-fetch");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const BOLNA_API_KEY = process.env.api_key;
const BOLNA_AGENT_ID = process.env.agent_id;
const SHEET_ID = process.env.SHEET_ID;
const SA_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './sheet.json';

const auth = new google.auth.GoogleAuth({
  keyFile: SA_KEY_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({version: 'v4', auth});

async function readRows(range='Sheet1!A2:K') {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
  return res.data.values || [];
}

async function updateRow(rowNumber, values) {
  const range = `Sheet1!A${rowNumber}:G${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [ values ] }
  });
}

app.post('/start-calls', async (req, res) => {
  try {
    let bolnaData= null;
    const rows = await readRows();
    let rowNumber = 2;
    const initiated = [];
    for (const r of rows) {
      const id = r[0] || '';
      const phone = r[1];
      const name = r[2] || '';
      const call_status = r[3] || '';

      console.log(`id is ${id}  , phone is ${phone}, name is ${name}  `);

      if (!phone) { rowNumber++; continue; }
      if (call_status && call_status.trim() !== '') { rowNumber++; continue; }

    const url = "https://api.bolna.ai/call";

    const payload = {
    agent_id: BOLNA_AGENT_ID,
    recipient_phone_number: phone,
    // from_phone_number: "+918035735856",
    scheduled_at: null,
    user_data: {
        variable1: name,
        variable2: "student",
        variable3: "say that you are proud of him",
    },
    };

    let bolnaData = null;

    try {
    const response = await axios.post(url, payload, {
        headers: {
        Authorization: `Bearer ${BOLNA_API_KEY}`,
        "Content-Type": "application/json",
        },
    });

    bolnaData = response.data;
    console.log("Bolna API Response:", bolnaData);

    } catch (error) {
    console.error("Error calling Bolna:", error.response?.data || error.message);
    rowNumber++;
    continue;
    }

    const status = bolnaData.status || "";
    const message = bolnaData.message || "";
    const execution_id = bolnaData.execution_id || "";

    console.log("Status:", status);
    console.log("Message:", message);
    console.log("Execution ID:", execution_id);

    // write back to Google Sheet
    const now = new Date().toISOString();
    const newRowValues = [id, phone, name, "initiated", execution_id, "", now];
    await updateRow(rowNumber, newRowValues);

    initiated.push({ row: rowNumber, phone, execution_id });
    rowNumber++;
    }

  } catch (err) {
    console.error(err.message, err.response && err.response.data);
    res.status(500).json({ error: err.message });
  }
});

//Webhook
app.post('/webhook/bolna', async (req, res) => {
  try {
    const event = req.body;
    console.log('Webhook event', JSON.stringify(event).slice(0,1000));

    const callId = event.id;
    const status = event.status;
    const resultText = event.transcript;
    const error_msg = event.error_message;
    const extracted_data = event.extracted_data;

    console.log("***Extracted data : ",extracted_data);

    const rows = await readRows();
    let rowNumber = 2;
    let foundRow = null;
    for (const r of rows) {
      const call_sid = r[4] || '';
      if (call_sid === callId) { foundRow = { rowNumber, row: r }; break; }
      rowNumber++;
    }

    if (!foundRow) {
      console.warn('No sheet row found for call id', callId);
      return res.status(200).send('ok');
    }

    if (status === 'completed') {
      const r = foundRow.row;
      r[3] = status;
      r[5] = resultText || 'completed';
      r[6] = new Date().toISOString();
      r[7] = extracted_data.user_interest;
      await updateRow(foundRow.rowNumber, r);
    } else {
      const r = foundRow.row;
      r[3] = status;
      r[6] = new Date().toISOString();
      await updateRow(foundRow.rowNumber, r);
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('webhook error', err);
    res.status(500).send('error');
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
  console.log(`Expose webhook to internet (ngrok)`);
});

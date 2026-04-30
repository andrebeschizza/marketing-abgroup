// Google Sheets client — leitura e escrita via Service Account
import { google } from 'googleapis';

let sheetsClient = null;

function getCredentials() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado');
  }
  try {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON inválido: ' + e.message);
  }
}

function getClient() {
  if (sheetsClient) return sheetsClient;
  const credentials = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

const SHEET_ID = () => {
  if (!process.env.SHEET_ID) throw new Error('SHEET_ID não configurado');
  return process.env.SHEET_ID;
};

export async function readSheet(tabName) {
  const sheets = getClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: tabName,
  });
  const rows = response.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1).map((row, idx) => {
    const obj = { __row: idx + 2 };
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
}

export async function appendRow(tabName, rowObj) {
  const sheets = getClient();
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${tabName}!1:1`,
  });
  const headers = (headerResp.data.values?.[0] || []).map(h => String(h).trim());
  if (headers.length === 0) throw new Error(`Aba "${tabName}" não tem cabeçalho.`);
  const row = headers.map(h => {
    const v = rowObj[h];
    return v === undefined || v === null ? '' : String(v);
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: tabName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  return { ok: true };
}

export async function updateRow(tabName, rowNumber, rowObj) {
  const sheets = getClient();
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${tabName}!1:1`,
  });
  const headers = (headerResp.data.values?.[0] || []).map(h => String(h).trim());
  const row = headers.map(h => {
    const v = rowObj[h];
    return v === undefined || v === null ? '' : String(v);
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID(),
    range: `${tabName}!A${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
  return { ok: true };
}

export async function listTabs() {
  const sheets = getClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID(),
    fields: 'sheets.properties.title',
  });
  return (response.data.sheets || []).map(s => s.properties.title);
}

export async function ping() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.SHEET_ID) {
    return { ok: false, reason: 'Credenciais ou SHEET_ID ausentes' };
  }
  try {
    const tabs = await listTabs();
    return { ok: true, tabs: tabs.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

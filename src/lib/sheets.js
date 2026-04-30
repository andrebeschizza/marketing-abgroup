// Google Sheets client — leitura e escrita via Service Account
import { google } from 'googleapis';

let sheetsClient = null;

function getCredentials() {
  // Prioridade 1: base64 (mais robusto no Render — sem problema de \n)
  if (process.env.GOOGLE_SA_KEY_B64) {
    try {
      const decoded = Buffer.from(process.env.GOOGLE_SA_KEY_B64, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch (e) {
      throw new Error('GOOGLE_SA_KEY_B64 inválido: ' + e.message);
    }
  }
  // Prioridade 2: JSON cru (legado)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON inválido: ' + e.message);
    }
  }
  throw new Error('Credenciais ausentes (defina GOOGLE_SA_KEY_B64 ou GOOGLE_SERVICE_ACCOUNT_JSON)');
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

// Lê todas as linhas de uma aba como objetos {coluna: valor}
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
    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? row[i] : '';
    });
    return obj;
  });
}

// Adiciona linha nova no fim de uma aba
export async function appendRow(tabName, rowObj) {
  const sheets = getClient();

  // Pega headers pra alinhar a ordem
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${tabName}!1:1`,
  });
  const headers = (headerResp.data.values?.[0] || []).map(h => String(h).trim());

  if (headers.length === 0) {
    throw new Error(`Aba "${tabName}" não tem cabeçalho. Crie a aba primeiro.`);
  }

  const row = headers.map(h => {
    const v = rowObj[h];
    return v === undefined || v === null ? '' : String(v);
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: tabName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });

  return { ok: true };
}

// Atualiza linha específica (1-indexed)
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
    requestBody: {
      values: [row],
    },
  });

  return { ok: true };
}

// Lista as abas existentes na planilha (útil pra setup)
export async function listTabs() {
  const sheets = getClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID(),
    fields: 'sheets.properties.title',
  });
  return (response.data.sheets || []).map(s => s.properties.title);
}

// Cria uma aba nova com cabeçalhos
export async function createTab(tabName, headers) {
  const sheets = getClient();

  // Cria a aba
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID(),
    requestBody: {
      requests: [{
        addSheet: { properties: { title: tabName } },
      }],
    },
  });

  // Adiciona headers
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID(),
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [headers],
    },
  });

  return { ok: true };
}

// Status de saúde do client (pra healthz)
export async function ping() {
  const hasCreds = !!(process.env.GOOGLE_SA_KEY_B64 || process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!hasCreds || !process.env.SHEET_ID) {
    return {
      ok: false,
      reason: 'Credenciais ou SHEET_ID ausentes',
      debug: {
        hasB64: !!process.env.GOOGLE_SA_KEY_B64,
        b64Len: (process.env.GOOGLE_SA_KEY_B64 || '').length,
        hasJson: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
        jsonLen: (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').length,
        hasSheetId: !!process.env.SHEET_ID,
      },
    };
  }
  try {
    const tabs = await listTabs();
    return { ok: true, tabs: tabs.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

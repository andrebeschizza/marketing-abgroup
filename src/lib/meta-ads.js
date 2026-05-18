// Cliente Meta Marketing API — puxa spend (gasto) de Ad Accounts.
// Doc: https://developers.facebook.com/docs/marketing-api/insights
//
// Env vars necessárias:
//   META_ACCESS_TOKEN — System User Token (sem expiração) ou User Token longo (60d)
//   META_AD_ACCOUNT_ID — pode ser "act_XXX" ou só "XXX" (vamos normalizar)
//
// Rate limit: ~200 chamadas/hora por app — folgado pra 1 sync diário.

const API_BASE = 'https://graph.facebook.com/v21.0';

function getToken() {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new Error('META_ACCESS_TOKEN não configurado');
  return t;
}

function getAdAccountId() {
  const raw = process.env.META_AD_ACCOUNT_ID;
  if (!raw) throw new Error('META_AD_ACCOUNT_ID não configurado');
  // Normaliza: adiciona prefixo "act_" se não tiver
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

async function metaGet(path, params = {}) {
  const url = new URL(`${API_BASE}/${path.replace(/^\//, '')}`);
  url.searchParams.set('access_token', getToken());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Meta ${path}: ${msg}`);
  }
  return data;
}

// Retorna spend total do mês corrente (em R$, já que Meta retorna na moeda da conta).
// Usa date_preset=this_month que já é o agregado correto.
export async function spendDoMesAtual() {
  const accountId = getAdAccountId();
  const insights = await metaGet(`${accountId}/insights`, {
    fields: 'spend',
    date_preset: 'this_month',
    level: 'account',
  });
  const arr = insights?.data || [];
  if (arr.length === 0) return 0;
  const spend = parseFloat(arr[0].spend || '0');
  return isNaN(spend) ? 0 : Math.round(spend * 100) / 100;
}

// Health check — valida token e ad account
export async function metaHealthcheck() {
  try {
    const accountId = getAdAccountId();
    const r = await metaGet(accountId, { fields: 'name,currency,account_status' });
    return { ok: true, conta: r.name, currency: r.currency, status: r.account_status };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

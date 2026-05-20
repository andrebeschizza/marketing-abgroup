// Cliente HTTP para a API ADVBOX. Bearer + User-Agent (sem UA o Cloudflare bloqueia 403).
// Doc: https://api.softwareadvbox.com.br/docs

const BASE_URL = 'https://app.advbox.com.br/api/v1';
const USER_AGENT = 'Mozilla/5.0 (Marketing-AB-Group-Cowork)';

function getToken() {
  const t = process.env.ADVBOX_TOKEN;
  if (!t) throw new Error('ADVBOX_TOKEN não configurado no env');
  return t;
}

async function advboxGet(path, params = {}) {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`ADVBOX ${path} HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// Retorna primeiro e último dia do mês corrente como strings YYYY-MM-DD
export function mesAtual() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const primeiro = new Date(ano, mes, 1);
  const ultimo = new Date(ano, mes + 1, 0);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(primeiro), end: fmt(ultimo) };
}

// ===== KPI 1: LEADS — customers criados no mês =====
export async function countLeadsDoMes({ start, end } = mesAtual()) {
  // limit=1 só pra pegar totalCount
  const r = await advboxGet('/customers', {
    created_start: start,
    created_end: end,
    limit: 1,
  });
  return r.totalCount || 0;
}

// Conta leads (customers) criados nos últimos N dias — usado pra conversão por janela
export async function countLeadsUltimosDias(dias = 60) {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const r = await advboxGet('/customers', {
    created_start: fmt(inicio),
    created_end: fmt(hoje),
    limit: 1,
  });
  return r.totalCount || 0;
}

// ===== KPI 2: QUALIFICADOS — task ANÁLISE DE CASO (3346695) =====
// Observação: usando created (SDR criou a análise). Se for completed, ajustar pra completed_start/end.
const TASK_ID_ANALISE_CASO = 3346695;
export async function countQualificadosDoMes({ start, end } = mesAtual()) {
  const r = await advboxGet('/posts', {
    task_id: TASK_ID_ANALISE_CASO,
    created_start: start,
    created_end: end,
    limit: 1,
  });
  return r.totalCount || 0;
}

// ===== KPI 3: ATENDIDOS — task ATENDIMENTO CLIENTE NOVO (3346698) CONCLUÍDA =====
const TASK_ID_ATENDIMENTO_NOVO = 3346698;
export async function countAtendidosDoMes({ start, end } = mesAtual()) {
  const r = await advboxGet('/posts', {
    task_id: TASK_ID_ATENDIMENTO_NOVO,
    completed_start: start,
    completed_end: end,
    limit: 1,
  });
  return r.totalCount || 0;
}

// ===== KPI 4: CONTRATOS — tasks que contém "CONTRATO DE HONORÁRIOS FECHADO" =====
// API não permite filtrar por nome, então paginamos e filtramos client-side.
// Usa completed_start/end (contrato considerado fechado quando task é concluída).
const CONTRATO_PREFIX = 'CONTRATO DE HONORÁRIOS FECHADO';
export async function countContratosDoMes({ start, end } = mesAtual()) {
  let total = 0;
  let offset = 0;
  const limit = 100;
  const maxPages = 20; // safety: até 2000 tasks/mês concluídas no mês
  for (let p = 0; p < maxPages; p++) {
    const r = await advboxGet('/posts', {
      completed_start: start,
      completed_end: end,
      limit,
      offset,
    });
    const data = r.data || [];
    if (data.length === 0) break;
    for (const t of data) {
      const nome = String(t.task || '').toUpperCase();
      if (nome.startsWith(CONTRATO_PREFIX)) total++;
    }
    if (data.length < limit) break; // última página
    offset += limit;
  }
  return total;
}

// Retorna snapshot dos 4 KPIs do mês corrente, em paralelo (respeitando rate limit 30/min)
export async function snapshotKpisAdvbox() {
  const periodo = mesAtual();
  const [leads, qualificados, atendidos, contratos] = await Promise.all([
    countLeadsDoMes(periodo).catch(e => ({ error: e.message })),
    countQualificadosDoMes(periodo).catch(e => ({ error: e.message })),
    countAtendidosDoMes(periodo).catch(e => ({ error: e.message })),
    countContratosDoMes(periodo).catch(e => ({ error: e.message })),
  ]);
  return {
    periodo,
    leads,
    qualificados,
    atendidos,
    contratos,
  };
}

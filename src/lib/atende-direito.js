// Cliente HTTP para a API REST do Atende Direito.
//
// O Atende Direito é onde TODO lead digital cai primeiro (Meta, YouTube, Google,
// WhatsApp, LP — a LP dispara mensagem ativa de WhatsApp em 2 min). Cada lead vira
// um card num board de funil (ticket-list). O KPI "Leads" do mês = soma das ações
// "create" no log desses boards no mês corrente.
//
// Base REST: https://app.atendedireito.com.br/api
// Auth: header Authorization: Bearer <token>  (env ATENDE_API_TOKEN)

const BASE_URL = 'https://app.atendedireito.com.br/api';

// Boards (ticket-lists) que representam o funil de leads de marketing:
//   2941 = "📊 Pipeline de Leads" (board unificado)
//   2631 = "AposentaBR"
// Os boards de SAC (suporte ao cliente) NÃO entram — não são leads de marketing.
// Ajustável via env ATENDE_LEADS_LIST_IDS (lista separada por vírgula).
const LEADS_LIST_IDS = (process.env.ATENDE_LEADS_LIST_IDS || '2941,2631')
  .split(',')
  .map(s => parseInt(s.trim(), 10))
  .filter(Boolean);

const PAGE_LIMIT = 100;
const MAX_PAGES = 200;   // trava de segurança por board
const CONCURRENCY = 6;   // páginas buscadas em paralelo

function getToken() {
  const t = process.env.ATENDE_API_TOKEN;
  if (!t) throw new Error('ATENDE_API_TOKEN não configurado no env');
  return t;
}

async function adGet(path, params = {}, attempt = 1) {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  let res;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Accept': 'application/json',
      },
    });
  } catch (e) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 800 * attempt));
      return adGet(path, params, attempt + 1);
    }
    throw e;
  }
  if (!res.ok) {
    // 429 (rate limit) e 5xx → retry com backoff
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise(r => setTimeout(r, 800 * attempt));
      return adGet(path, params, attempt + 1);
    }
    const txt = await res.text().catch(() => '');
    throw new Error(`Atende Direito ${path} HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// Primeiro instante do mês corrente e agora, como unix timestamps (segundos).
export function mesAtualUnix() {
  const hoje = new Date();
  const primeiro = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0, 0);
  return {
    start: Math.floor(primeiro.getTime() / 1000),
    end: Math.floor(Date.now() / 1000),
  };
}

function contaCreates(data) {
  let n = 0;
  for (const x of (data || [])) {
    if (String(x.action || '') === 'create') n++;
  }
  return n;
}

// Conta as ações "create" (= novos cards/leads) no log de um board, num período.
// O endpoint log-data não filtra por tipo de ação, então paginamos e filtramos.
// Páginas 2..N são buscadas em paralelo (lotes de CONCURRENCY) pra ganhar tempo.
export async function countCreatesNoBoard(listId, startUnix, endUnix) {
  const fetchPage = (page) => adGet(`/team/ticket-lists/${listId}/log-data`, {
    start_time: startUnix,
    end_time: endUnix,
    limit: PAGE_LIMIT,
    page,
  });

  const first = await fetchPage(1);
  let creates = contaCreates(first.data);
  const lastPage = Math.min((first.meta && first.meta.last_page) || 1, MAX_PAGES);
  if (lastPage <= 1) return creates;

  for (let p = 2; p <= lastPage; p += CONCURRENCY) {
    const batch = [];
    for (let i = p; i < p + CONCURRENCY && i <= lastPage; i++) batch.push(fetchPage(i));
    const results = await Promise.all(batch);
    for (const r of results) creates += contaCreates(r.data);
  }
  return creates;
}

// KPI "Leads" = soma dos novos cards de leads do mês corrente, em todos os
// boards de funil de marketing. Lança erro se o token não estiver configurado.
export async function countLeadsAtendeMesAtual() {
  const { start, end } = mesAtualUnix();
  let total = 0;
  for (const listId of LEADS_LIST_IDS) {
    total += await countCreatesNoBoard(listId, start, end);
  }
  return total;
}

// Versão detalhada (total + quebra por board) — útil pra diagnóstico.
export async function leadsAtendeDetalhado() {
  const { start, end } = mesAtualUnix();
  const porBoard = {};
  let total = 0;
  for (const listId of LEADS_LIST_IDS) {
    const n = await countCreatesNoBoard(listId, start, end);
    porBoard[listId] = n;
    total += n;
  }
  return { total, porBoard, listIds: LEADS_LIST_IDS, periodo: { start, end } };
}

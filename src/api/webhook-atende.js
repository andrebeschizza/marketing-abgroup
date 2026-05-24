// Webhook do Atende Direito → indicador "Leads" (digital).
//
// O Atende Direito é o ponto onde TODO lead digital cai primeiro (Meta, YouTube,
// Google, WhatsApp). O n8n da equipe dispara um POST aqui a cada novo atendimento.
// Cada chamada = 1 lead. Gravamos em leads_log; o auto-calc conta os do mês e
// atualiza o KPI "Leads". Endpoint PÚBLICO (n8n não tem sessão) — protegido por token.
import { appendRow, listTabs, createTab, readSheet } from '../lib/sheets.js';

const LEADS_LOG_TAB = 'leads_log';
const LEADS_LOG_HEADER = ['Data', 'Canal', 'TicketId', 'RecebidoEm'];

// Secret compartilhado. Configurável via env ATENDE_WEBHOOK_SECRET;
// tem default pra funcionar sem precisar mexer no Render.
const WEBHOOK_SECRET = process.env.ATENDE_WEBHOOK_SECRET || 'atd_wh_Kp9mLx2QvR7nT4';

// Cache: evita listTabs() a cada chamada do webhook
let tabReady = false;
async function ensureLeadsLogTab() {
  if (tabReady) return;
  const tabs = await listTabs();
  if (!tabs.includes(LEADS_LOG_TAB)) {
    await createTab(LEADS_LOG_TAB, LEADS_LOG_HEADER);
  }
  tabReady = true;
}

function checkToken(req) {
  const token = req.query.token || req.get('X-Webhook-Token') || (req.body && req.body.token);
  return token === WEBHOOK_SECRET;
}

// POST /api/webhook/atende-direito — registra 1 lead novo
export async function webhookAtendeDireito(req, res) {
  if (!checkToken(req)) {
    return res.status(401).json({ error: 'token inválido ou ausente' });
  }
  try {
    await ensureLeadsLogTab();
    const body = req.body || {};
    const agora = new Date();
    await appendRow(LEADS_LOG_TAB, {
      'Data': agora.toISOString().slice(0, 10),
      'Canal': String(body.canal || body.channel || body.origem || '').slice(0, 60),
      'TicketId': String(body.ticketId || body.ticket_id || body.id || '').slice(0, 60),
      'RecebidoEm': agora.toISOString(),
    });
    res.json({ ok: true, registrado: true });
  } catch (e) {
    console.error('[webhook-atende] erro:', e.message);
    res.status(500).json({ error: e.message });
  }
}

// GET /api/webhook/atende-direito — liveness + (com token) status do mês
export async function webhookAtendeStatus(req, res) {
  if (!checkToken(req)) {
    return res.json({
      ok: true,
      info: 'Webhook Atende Direito no ar. Envie POST com ?token=SEU_TOKEN para registrar um lead.',
    });
  }
  try {
    let rows = [];
    try { rows = await readSheet(LEADS_LOG_TAB); } catch { /* aba ainda não existe */ }
    const hoje = new Date();
    const pref = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    const doMes = rows.filter(r => String(r['Data'] || '').startsWith(pref));
    res.json({
      ok: true,
      leadsNoMes: doMes.length,
      totalRegistros: rows.length,
      ultimos: rows.slice(-3).map(r => ({ data: r['Data'], canal: r['Canal'], ticketId: r['TicketId'] })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

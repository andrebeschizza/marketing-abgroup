// /api/notificacoes — Sistema de notificações in-app (substitui Telegram bots)
import { readSheet, appendRow, updateRow, listTabs, createTab } from '../lib/sheets.js';
import { PERFIS } from '../middleware/auth.js';

const TAB = 'notificacoes';
const HEADERS = [
  'Tipo',           // demanda_nova | calendario_movido | alerta_novo | sistema | manual
  'Titulo',         // Texto curto do que aconteceu
  'Detalhe',        // Detalhes (opcional)
  'URL',            // Link relativo (opcional, ex: /#calendario)
  'Para',           // 'all' | perfil específico | csv 'mkt,abadv'
  'Marca',          // Marca relacionada (opcional)
  'LidaPor',        // CSV de perfis que já marcaram como lida
  'Criado em',      // ISO timestamp
];

async function ensureTab() {
  const tabs = await listTabs();
  if (!tabs.includes(TAB)) {
    await createTab(TAB, HEADERS);
  }
}

// Helper interno (não-API): cria notificação programaticamente
// Usado por outros endpoints (createDemanda, updateCalendarioStatus, etc).
export async function notify({ tipo, titulo, detalhe, url, para, marca }) {
  try {
    await ensureTab();
    await appendRow(TAB, {
      'Tipo': tipo || 'sistema',
      'Titulo': titulo || '',
      'Detalhe': detalhe || '',
      'URL': url || '',
      'Para': para || 'all',
      'Marca': marca || '',
      'LidaPor': '',
      'Criado em': new Date().toISOString(),
    });
  } catch (e) {
    console.error('[notify] erro:', e.message);
  }
}

// Verifica se uma notificação é destinada a este perfil
function isForProfile(notifPara, perfil, marca) {
  if (!notifPara) return true;
  if (notifPara === 'all') return true;
  const targets = notifPara.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (targets.includes(perfil)) return true;
  // Se nota é da marca do usuário (perfil vertical)
  if (marca && targets.includes(marca.toLowerCase())) return true;
  return false;
}

// GET /api/notificacoes — lista as do usuário atual (não-lidas primeiro, max 50)
export async function listNotificacoes(req, res) {
  try {
    await ensureTab();
    const rows = await readSheet(TAB);
    const perfil = req.session?.perfil || 'mkt';
    const conf = PERFIS[perfil] || PERFIS.mkt;
    const minhaMarca = conf.marca;

    const items = rows
      .filter(r => r['Titulo'])
      .filter(r => isForProfile(r['Para'], perfil, minhaMarca))
      // Vertical só vê notif da própria marca (se marca setada)
      .filter(r => {
        if (!minhaMarca) return true;
        if (!r['Marca']) return true; // notif geral também aparece
        return r['Marca'] === minhaMarca;
      })
      .map(r => {
        const lidaPor = (r['LidaPor'] || '').split(',').map(s => s.trim()).filter(Boolean);
        return {
          row: r.__row,
          tipo: r['Tipo'] || 'sistema',
          titulo: r['Titulo'] || '',
          detalhe: r['Detalhe'] || '',
          url: r['URL'] || '',
          marca: r['Marca'] || '',
          lida: lidaPor.includes(perfil),
          criadoEm: r['Criado em'] || '',
        };
      })
      .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''))
      .slice(0, 50);

    const naoLidas = items.filter(i => !i.lida).length;
    res.json({ total: items.length, naoLidas, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/notificacoes — admin cria nova manualmente
export async function createNotificacao(req, res) {
  const { tipo, titulo, detalhe, url, para, marca } = req.body || {};
  if (!titulo) return res.status(400).json({ error: 'Campo obrigatório: titulo' });
  await notify({ tipo: tipo || 'manual', titulo, detalhe, url, para: para || 'all', marca });
  res.json({ ok: true });
}

// PATCH /api/notificacoes/:row/lida — marca como lida pelo perfil atual
export async function marcarLida(req, res) {
  const row = parseInt(req.params.row, 10);
  if (!row) return res.status(400).json({ error: 'row obrigatório' });
  const perfil = req.session?.perfil || 'mkt';
  try {
    await ensureTab();
    const rows = await readSheet(TAB);
    const target = rows.find(r => r.__row === row);
    if (!target) return res.status(404).json({ error: 'Notificação não encontrada' });
    const lidaPor = (target['LidaPor'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!lidaPor.includes(perfil)) {
      lidaPor.push(perfil);
      target['LidaPor'] = lidaPor.join(',');
      await updateRow(TAB, row, target);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// PATCH /api/notificacoes/marcar-todas-lidas
export async function marcarTodasLidas(req, res) {
  const perfil = req.session?.perfil || 'mkt';
  const conf = PERFIS[perfil] || PERFIS.mkt;
  const minhaMarca = conf.marca;
  try {
    await ensureTab();
    const rows = await readSheet(TAB);
    let count = 0;
    for (const r of rows) {
      if (!r['Titulo']) continue;
      if (!isForProfile(r['Para'], perfil, minhaMarca)) continue;
      if (minhaMarca && r['Marca'] && r['Marca'] !== minhaMarca) continue;
      const lidaPor = (r['LidaPor'] || '').split(',').map(s => s.trim()).filter(Boolean);
      if (lidaPor.includes(perfil)) continue;
      lidaPor.push(perfil);
      r['LidaPor'] = lidaPor.join(',');
      await updateRow(TAB, r.__row, r);
      count++;
    }
    res.json({ ok: true, marcadas: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

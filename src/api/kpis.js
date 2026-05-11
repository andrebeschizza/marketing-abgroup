// /api/kpis — Lê KPIs do mês da aba "kpis"
import { readSheet, updateRange, clearRange, createTab, deleteSheetIfExists, listTabs, appendRow } from '../lib/sheets.js';

// Parse "225,233,241,249,257" → [225,233,241,249,257]
function parseTiers(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map(s => parseFloat(s.trim().replace(',', '.')))
    .filter(n => !isNaN(n) && n > 0);
}

export async function getKpis(req, res) {
  try {
    const rows = await readSheet('kpis');
    const kpis = rows.map(r => {
      const meta = parseFloat(String(r['Meta'] || '0').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
      const realizado = parseFloat(String(r['Realizado'] || '0').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
      const pct = meta > 0 ? Math.round((realizado / meta) * 100) : 0;
      let status = 'critico';
      if (pct >= 100) status = 'verde';
      else if (pct >= 70) status = 'amarelo';
      const tiers = parseTiers(r['Tiers']);
      // Próximo tier (se já passou da meta base)
      let proximoTier = null;
      if (tiers.length && realizado >= meta) {
        proximoTier = tiers.find(t => realizado < t) || null;
      }
      return {
        indicador: r['Indicador'] || '',
        meta,
        realizado,
        unidade: r['Unidade'] || '',
        pct,
        status,
        atualizado: r['Atualizado em'] || r['Atualizado'] || '',
        tiers,
        proximoTier,
      };
    });
    res.json({ kpis });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /api/admin/seed-kpis — limpa e popula a aba kpis com o set padrão (11 KPIs).
// Idempotente — pode rodar várias vezes; sempre reseta pro estado canônico.
// IMPORTANTE: zera Realizado pra 0. Use SOMENTE no setup inicial ou pra reset.
const SEED_KPIS = [
  // [Indicador, Meta, Realizado, Unidade, Atualizado em, Tiers]
  ['Leads',                          2500, 0, 'leads',         '', ''],
  ['Qualificados',                    560, 0, 'qualificados',  '', ''],
  ['Atendidos pela equipe',           200, 0, 'atendimentos',  '', ''],
  ['Contratos',                       220, 0, 'contratos',     '', '225,233,241,249,257'],
  ['Conversão Lead→Contrato',          23, 0, '%',             '', ''],
  ['Vídeos publicados',                40, 0, 'vídeos',        '', ''],
  ['Inscritos YouTube ganhos',       1000, 0, 'inscritos',     '', ''],
  ['Notícias publicadas no blog',       4, 0, 'matérias',      '', ''],
  ['Investimento Ads total',        15000, 0, 'R$',            '', ''],
  ['ROAS',                              4, 0, 'x',             '', ''],
  ['CPL',                               6, 0, 'R$',            '', ''],
];

const HEADER = ['Indicador', 'Meta', 'Realizado', 'Unidade', 'Atualizado em', 'Tiers'];
const HISTORICO_TAB = 'kpis_historico';
const HISTORICO_HEADER = ['Data', 'Indicador', 'Realizado', 'Meta', 'Pct'];

// Garante que a aba kpis_historico existe
async function ensureHistoricoTab() {
  const tabs = await listTabs();
  if (!tabs.includes(HISTORICO_TAB)) {
    await createTab(HISTORICO_TAB, HISTORICO_HEADER);
  }
}

// POST /api/admin/snapshot-kpis — captura snapshot do estado atual de todos KPIs
// e adiciona uma linha por indicador na aba kpis_historico.
// Idempotente por dia: se já tem snapshot do dia, não duplica.
export async function snapshotKpis(req, res) {
  try {
    await ensureHistoricoTab();
    const hoje = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const existing = await readSheet(HISTORICO_TAB);
    const jaTemHoje = existing.some(r => String(r['Data'] || '').startsWith(hoje));
    if (jaTemHoje) {
      return res.json({ ok: true, skipped: true, message: `Snapshot de ${hoje} já existe.` });
    }
    const kpisRows = await readSheet('kpis');
    const inserted = [];
    for (const r of kpisRows) {
      if (!r['Indicador']) continue;
      const meta = parseFloat(String(r['Meta'] || '0').replace(',', '.')) || 0;
      const realizado = parseFloat(String(r['Realizado'] || '0').replace(',', '.')) || 0;
      const pct = meta > 0 ? Math.round((realizado / meta) * 100) : 0;
      await appendRow(HISTORICO_TAB, {
        'Data': hoje,
        'Indicador': r['Indicador'],
        'Realizado': realizado,
        'Meta': meta,
        'Pct': pct,
      });
      inserted.push(r['Indicador']);
    }
    res.json({ ok: true, data: hoje, snapshots: inserted.length, indicadores: inserted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// GET /api/kpis/:indicador/historico — retorna histórico (últimos 60 dias) do indicador
export async function getKpiHistorico(req, res) {
  const indicador = decodeURIComponent(req.params.indicador || '').trim();
  if (!indicador) return res.status(400).json({ error: 'Indicador obrigatório' });
  try {
    await ensureHistoricoTab();
    const rows = await readSheet(HISTORICO_TAB);
    const norm = s => String(s || '').toLowerCase().trim();
    const filtered = rows
      .filter(r => norm(r['Indicador']) === norm(indicador))
      .map(r => ({
        data: r['Data'] || '',
        realizado: parseFloat(String(r['Realizado'] || '0').replace(',', '.')) || 0,
        meta: parseFloat(String(r['Meta'] || '0').replace(',', '.')) || 0,
        pct: parseInt(String(r['Pct'] || '0').replace(',', '.'), 10) || 0,
      }))
      .sort((a, b) => a.data.localeCompare(b.data))
      .slice(-60); // últimos 60 dias
    res.json({ indicador, historico: filtered });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// PATCH /api/kpis/:indicador — atualiza Realizado + Atualizado em
// Body: { realizado: number }
export async function updateKpi(req, res) {
  const indicador = decodeURIComponent(req.params.indicador || '').trim();
  const { realizado } = req.body || {};
  if (!indicador) return res.status(400).json({ error: 'Indicador obrigatório' });
  if (realizado === undefined || realizado === null || realizado === '') {
    return res.status(400).json({ error: 'Campo "realizado" obrigatório' });
  }
  const numRealizado = parseFloat(String(realizado).replace(',', '.'));
  if (isNaN(numRealizado)) return res.status(400).json({ error: 'realizado deve ser número' });

  try {
    const rows = await readSheet('kpis');
    // Match case-insensitive e tolerante a espaços
    const norm = s => String(s || '').toLowerCase().trim();
    const target = rows.find(r => norm(r['Indicador']) === norm(indicador));
    if (!target) return res.status(404).json({ error: `Indicador "${indicador}" não encontrado` });

    const rowNum = target.__row;
    const now = new Date().toISOString();
    // Atualiza só C (Realizado) e E (Atualizado em) — não toca em Meta, Unidade, Tiers
    await updateRange('kpis', `C${rowNum}:C${rowNum}`, [[numRealizado]]);
    await updateRange('kpis', `E${rowNum}:E${rowNum}`, [[now]]);

    res.json({
      ok: true,
      indicador,
      realizado: numRealizado,
      atualizadoEm: now,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function seedKpis(req, res) {
  try {
    // 1. Apaga a aba inteira pra resetar formatação herdada (datas etc)
    await deleteSheetIfExists('kpis');
    // 2. Cria aba nova com header limpo
    await createTab('kpis', HEADER);
    // 3. Escreve as 11 linhas (a partir de A2)
    await updateRange('kpis', `A2:F${SEED_KPIS.length + 1}`, SEED_KPIS);
    res.json({
      ok: true,
      message: `KPIs reseeded: ${SEED_KPIS.length} indicadores (aba recriada)`,
      indicadores: SEED_KPIS.map(r => r[0]),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

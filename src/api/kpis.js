// /api/kpis — Lê KPIs do mês da aba "kpis"
import { readSheet, updateRange, clearRange } from '../lib/sheets.js';

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

export async function seedKpis(req, res) {
  try {
    // 1. Limpa o range (mantém aba)
    await clearRange('kpis', 'A1:Z1000');
    // 2. Escreve header + dados num único range
    const matrix = [HEADER, ...SEED_KPIS];
    await updateRange('kpis', `A1:F${matrix.length}`, matrix);
    res.json({
      ok: true,
      message: `KPIs reseeded: ${SEED_KPIS.length} indicadores`,
      indicadores: SEED_KPIS.map(r => r[0]),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

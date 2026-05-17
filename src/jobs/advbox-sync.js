// Sync ADVBOX → KPIs. Roda 1x/dia (via cron interno em server.js).
// Busca contagens dos 4 KPIs (Leads/Qualificados/Atendidos/Contratos) do mês corrente
// e atualiza o valor "Realizado" desses 4 indicadores na aba kpis do Sheet.
import { readSheet, updateRange } from '../lib/sheets.js';
import { snapshotKpisAdvbox } from '../lib/advbox.js';

// Map: nome exato do indicador na aba kpis → chave do snapshot ADVBOX
const KPI_MAP = {
  'Leads': 'leads',
  'Qualificados': 'qualificados',
  'Atendidos pela equipe': 'atendidos',
  'Contratos': 'contratos',
};

export async function syncAdvbox() {
  const snap = await snapshotKpisAdvbox();
  const updates = [];
  const erros = [];

  // Lê linhas atuais da aba kpis pra achar a row de cada indicador
  const rows = await readSheet('kpis');
  const now = new Date().toISOString();

  for (const [indicador, snapKey] of Object.entries(KPI_MAP)) {
    const valor = snap[snapKey];
    if (typeof valor !== 'number') {
      erros.push({ indicador, motivo: valor?.error || 'sem dado' });
      continue;
    }
    const row = rows.find(r => String(r['Indicador'] || '').trim() === indicador);
    if (!row) {
      erros.push({ indicador, motivo: 'indicador não encontrado na aba kpis' });
      continue;
    }
    // Atualiza C (Realizado) e E (Atualizado em) da linha
    await updateRange('kpis', `C${row.__row}:C${row.__row}`, [[valor]]);
    await updateRange('kpis', `E${row.__row}:E${row.__row}`, [[now]]);
    updates.push({ indicador, novoRealizado: valor });
  }

  return {
    periodo: snap.periodo,
    sincronizados: updates,
    erros,
    timestamp: now,
  };
}

// Endpoint manual (admin) pra disparar sync
export async function syncAdvboxHandler(req, res) {
  try {
    const result = await syncAdvbox();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

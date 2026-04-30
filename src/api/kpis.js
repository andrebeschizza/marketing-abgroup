// /api/kpis — Lê KPIs do mês da aba "kpis"
import { readSheet } from '../lib/sheets.js';

export async function getKpis(req, res) {
  try {
    const rows = await readSheet('kpis');
    const kpis = rows.map(r => {
      const meta = parseFloat(String(r['Meta'] || '0').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
      const realizado = parseFloat(String(r['Realizado'] || '0').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
      const pct = meta > 0 ? Math.round((realizado / meta) * 100) : 0;
      let status = 'critico';
      if (pct >= 90) status = 'verde';
      else if (pct >= 60) status = 'amarelo';
      return {
        indicador: r['Indicador'] || '',
        meta,
        realizado,
        unidade: r['Unidade'] || '',
        pct,
        status,
        atualizado: r['Atualizado'] || '',
      };
    });
    res.json({ kpis });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

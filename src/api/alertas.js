// /api/alertas — Alertas críticos da semana
import { readSheet, appendRow } from '../lib/sheets.js';

export async function listAlertas(req, res) {
  try {
    let rows = [];
    try {
      rows = await readSheet('alertas');
    } catch (e) {
      return res.json({ alertas: [] });
    }

    const ativos = rows
      .filter(r => r['Titulo'] || r['Título'])
      .filter(r => (r['Resolvido'] || '').toLowerCase() !== 'sim')
      .map(r => ({
        row: r.__row,
        titulo: r['Titulo'] || r['Título'] || '',
        descricao: r['Descricao'] || r['Descrição'] || '',
        severidade: (r['Severidade'] || 'media').toLowerCase(),
        data: r['Data'] || '',
        responsavel: r['Responsavel'] || r['Responsável'] || '',
      }))
      .reverse();
    res.json({ total: ativos.length, alertas: ativos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function createAlerta(req, res) {
  const { titulo, descricao, severidade, responsavel } = req.body || {};
  if (!titulo) return res.status(400).json({ error: 'titulo é obrigatório' });

  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' });

  try {
    await appendRow('alertas', {
      'Data': data,
      'Titulo': titulo,
      'Descricao': descricao || '',
      'Severidade': severidade || 'media',
      'Responsavel': responsavel || '',
      'Resolvido': 'não',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

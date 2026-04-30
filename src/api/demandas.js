// /api/demandas — Lista e cria demandas ad-hoc
import { readSheet, appendRow, updateRow } from '../lib/sheets.js';

const ROUTING = {
  'Campanha': 'Ag. 1 → Ag. 2 → Ag. 4',
  'Post avulso': 'Ag. 2 → Ag. 4',
  'Roteiro YouTube longo': 'Ag. 7A',
  'Roteiro vídeo curto': 'Ag. 7B → Ag. 4',
  'Calendário mensal': 'Ag. 13 + Ag. 3 → Ag. 1 → Ag. 8',
  'Análise performance': 'Ag. 5',
  'SEO': 'Ag. 3',
  'Análise funil': 'Ag. 6',
  'Jornada ecossistema': 'Ag. 9 → Ag. 1 → Ag. 2',
  'Sugestão temas': 'Ag. 13 → Ag. 3 → Ag. 7A/7B',
  'Concorrência': 'Ag. 13',
  'Edição curtos': 'Ag. 11',
  'Edição longos': 'Ag. 12',
  'Agendamento': 'Ag. 10',
  'Notícia blog': 'Ag. 3 → Ag. 14',
  'Briefing SEO': 'Ag. 3 → Sherliany',
  'Parceria/Imprensa': 'Diretor MKT → DINO',
  'CRÍTICO crise': 'Ag. 0 (prioriza) → Ag. 13 → Ag. 7A/7B',
};

export async function listDemandas(req, res) {
  try {
    const rows = await readSheet('demandas');
    const demandas = rows
      .filter(r => r['Demanda'])
      .map(r => ({
        row: r.__row,
        demanda: r['Demanda'] || '',
        tipo: r['Tipo'] || '',
        empresa: r['Empresa'] || '',
        solicitante: r['Solicitante'] || '',
        prioridade: r['Prioridade'] || 'Normal',
        status: r['Status'] || 'Não iniciada',
        sequencia: r['Sequencia'] || '',
        briefing: r['Briefing'] || '',
        prazo: r['Prazo'] || '',
        submetido: r['Submetido em'] || '',
      }))
      .reverse();
    res.json({ total: demandas.length, demandas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function createDemanda(req, res) {
  const { demanda, tipo, empresa, solicitante, prioridade, briefing, prazo } = req.body || {};
  if (!demanda || !tipo) {
    return res.status(400).json({ error: 'Campos obrigatórios: demanda, tipo' });
  }
  const sequencia = ROUTING[tipo] || 'Ag. 0 vai classificar';
  const submetido = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Bahia',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  try {
    await appendRow('demandas', {
      'Demanda': demanda, 'Tipo': tipo,
      'Empresa': empresa || 'AB Group geral',
      'Solicitante': solicitante || 'Equipe AB Group',
      'Prioridade': prioridade || 'Normal',
      'Status': 'Não iniciada',
      'Sequencia': sequencia,
      'Briefing': briefing || '',
      'Prazo': prazo || '',
      'Submetido em': submetido,
    });
    res.json({ ok: true, sequencia });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function updateDemandaStatus(req, res) {
  const row = parseInt(req.params.row, 10);
  const { status } = req.body || {};
  if (!row || !status) return res.status(400).json({ error: 'row e status são obrigatórios' });
  try {
    const rows = await readSheet('demandas');
    const target = rows.find(r => r.__row === row);
    if (!target) return res.status(404).json({ error: 'Demanda não encontrada' });
    target['Status'] = status;
    await updateRow('demandas', row, target);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

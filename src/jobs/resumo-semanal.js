// Resumo semanal automático. Cron dispara sexta 17h (horário Brasília).
// Monta resumo dos KPIs + alertas e dispara notificação in-app.
import { readSheet } from '../lib/sheets.js';
import { notify, alreadyNotifiedToday } from '../api/notificacoes.js';

// Lê KPIs do Sheet e monta texto de resumo
async function montarResumo() {
  const rows = await readSheet('kpis').catch(() => []);
  const linhas = [];
  let verdes = 0, amarelos = 0, criticos = 0;

  for (const r of rows) {
    if (!r['Indicador']) continue;
    const meta = parseFloat(String(r['Meta'] || '0').replace(',', '.')) || 0;
    const real = parseFloat(String(r['Realizado'] || '0').replace(',', '.')) || 0;
    const pct = meta > 0 ? Math.round((real / meta) * 100) : 0;
    let emoji = '🔴';
    if (pct >= 100) { emoji = '🟢'; verdes++; }
    else if (pct >= 70) { emoji = '🟡'; amarelos++; }
    else criticos++;
    linhas.push(`${emoji} ${r['Indicador']}: ${real}/${meta} (${pct}%)`);
  }

  const hoje = new Date();
  const diaMes = hoje.getDate();
  const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const diasRestantes = ultimoDia - diaMes;

  return {
    detalhe: linhas.join('\n'),
    placar: `${verdes} no verde · ${amarelos} em atenção · ${criticos} críticos`,
    diasRestantes,
  };
}

// Dispara o resumo (idempotente por dia)
export async function dispararResumoSemanal({ force = false } = {}) {
  const hoje = new Date();
  const titulo = `📊 Resumo da semana — ${hoje.toLocaleDateString('pt-BR')}`;
  if (!force && await alreadyNotifiedToday(titulo)) {
    return { skipped: true, motivo: 'já enviado hoje' };
  }
  const resumo = await montarResumo();
  await notify({
    tipo: 'resumo_semanal',
    titulo,
    detalhe: `${resumo.placar}\n\n${resumo.detalhe}\n\n⏳ Faltam ${resumo.diasRestantes} dias pra fechar o mês. Abra o Relatório Executivo pra ver completo.`,
    url: '/relatorio.html',
    para: 'mkt',
  });
  return { ok: true, titulo, placar: resumo.placar };
}

// Endpoint admin pra testar manual (?force=1 ignora idempotência)
export async function dispararResumoHandler(req, res) {
  try {
    const out = await dispararResumoSemanal({ force: req.query.force === '1' });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// Checa se AGORA é sexta-feira entre 17h-18h (horário Brasília = UTC-3)
export function ehHorarioResumo() {
  const agora = new Date();
  // Converte pra horário Brasília
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const diaSemana = brasilia.getUTCDay(); // 5 = sexta
  const hora = brasilia.getUTCHours();
  return diaSemana === 5 && hora === 17;
}

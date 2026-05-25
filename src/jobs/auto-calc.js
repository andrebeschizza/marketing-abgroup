// KPIs auto-calculados a partir de dados que JÁ existem no Sheet.
// Não depende de API externa. Roda após o sync ADVBOX (precisa de Leads+Contratos atualizados).
//
// KPIs cobertos:
//   - "Vídeos publicados" = count de cards do calendário com Status="Publicado" e Data Publicação no mês corrente
//   - "Conversão Lead→Contrato" = (Contratos / Leads) × 100, arredondado pra inteiro
import { readSheet, updateRange, appendRow, listTabs, createTab } from '../lib/sheets.js';
import { countPostsBlogDoMes } from '../lib/blog-rss.js';
import { inscritosGanhosDoMes, getSubscriberCount } from '../lib/youtube.js';
import { spendDoMesAtual } from '../lib/meta-ads.js';
import { countLeadsUltimosDias } from '../lib/advbox.js';
import { countLeadsAtendeMesAtual } from '../lib/atende-direito.js';

// Snapshot do total ATUAL de inscritos no YouTube (gravado na aba kpis_historico).
// Permite calcular GANHO mensal: total_atual - menor_snapshot_do_mes.
const YT_INDICADOR_SNAPSHOT = '_YouTube Total';

async function snapshotYoutubeTotal() {
  // Garante aba kpis_historico (Sprint 7 já cria, mas paranoia)
  const tabs = await listTabs();
  if (!tabs.includes('kpis_historico')) {
    await createTab('kpis_historico', ['Data', 'Indicador', 'Realizado', 'Meta', 'Pct']);
  }
  const hoje = new Date().toISOString().slice(0, 10);
  const rows = await readSheet('kpis_historico');
  // Idempotente por dia
  const ja = rows.some(r => String(r['Data'] || '').startsWith(hoje) && String(r['Indicador'] || '') === YT_INDICADOR_SNAPSHOT);
  if (ja) return null;
  const { subscribers } = await getSubscriberCount();
  await appendRow('kpis_historico', {
    'Data': hoje,
    'Indicador': YT_INDICADOR_SNAPSHOT,
    'Realizado': subscribers,
    'Meta': 0,
    'Pct': 0,
  });
  return subscribers;
}

function mesAtual() {
  const hoje = new Date();
  return {
    ano: hoje.getFullYear(),
    mes: hoje.getMonth(), // 0-indexed
  };
}

// Conta cards do calendário publicados no mês corrente
async function calcVideosPublicados() {
  const cards = await readSheet('calendario').catch(() => []);
  const { ano, mes } = mesAtual();
  let count = 0;
  for (const c of cards) {
    if (!c['Título']) continue;
    if (String(c['Status'] || '').trim() !== 'Publicado') continue;
    const dataPub = String(c['Data Publicação'] || '').slice(0, 10); // YYYY-MM-DD
    const m = dataPub.match(/^(\d{4})-(\d{2})-/);
    if (!m) continue;
    if (parseInt(m[1], 10) !== ano) continue;
    if (parseInt(m[2], 10) - 1 !== mes) continue;
    count++;
  }
  return count;
}

// Leads digitais — contagem REAL vinda da API do Atende Direito.
// Soma os cards criados no mês nos boards de funil (Pipeline de Leads + AposentaBR).
// Retorna null se o token não está configurado (env ATENDE_API_TOKEN) →
// NÃO sobrescreve o valor manual nesse período de transição.
async function calcLeadsAtendeDireito() {
  if (!process.env.ATENDE_API_TOKEN) return null;
  return await countLeadsAtendeMesAtual();
}

// Lê o valor numérico de Realizado de um indicador
function readRealizado(rows, indicador) {
  const row = rows.find(r => String(r['Indicador'] || '').trim() === indicador);
  if (!row) return null;
  const n = parseFloat(String(row['Realizado'] || '0').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Calcula conversão Lead→Contrato por JANELA de 60 dias.
// Contratos fechados no mês ÷ Leads que entraram nos últimos 60 dias.
// Janela maior no denominador reflete o ciclo real de venda (lead leva ~45-60d pra fechar),
// evitando estouro absurdo (ex: 343% da meta) que acontece com Leads-do-mês.
async function calcConversao(rows) {
  const contratos = readRealizado(rows, 'Contratos');
  let leadsJanela = 0;
  if (process.env.ADVBOX_TOKEN) {
    leadsJanela = await countLeadsUltimosDias(60).catch(() => 0);
  }
  // Fallback: se não tem ADVBOX, usa Leads do mês do Sheet
  if (!leadsJanela) leadsJanela = readRealizado(rows, 'Leads');
  if (!leadsJanela || leadsJanela === 0) return 0;
  return Math.round((contratos / leadsJanela) * 100);
}

export async function runAutoCalc() {
  const rows = await readSheet('kpis');
  const now = new Date().toISOString();
  const updates = [];
  const erros = [];

  const noticias = await countPostsBlogDoMes().catch(e => { console.error('[blog-rss] erro:', e.message); return null; });

  // YouTube: snapshot do total atual + cálculo de ganho do mês
  let inscritosGanhos = null;
  try {
    await snapshotYoutubeTotal(); // idempotente por dia
    const historico = await readSheet('kpis_historico');
    const ytData = await inscritosGanhosDoMes(
      historico.filter(r => String(r['Indicador'] || '') === YT_INDICADOR_SNAPSHOT)
                .map(r => ({ Indicador: 'Inscritos YouTube ganhos', Data: r['Data'], Realizado: r['Realizado'] }))
    );
    inscritosGanhos = ytData.ganhoNoMes;
  } catch (e) {
    console.error('[youtube] erro:', e.message);
  }

  const calculos = [
    { indicador: 'Vídeos publicados', valor: await calcVideosPublicados() },
    { indicador: 'Conversão Lead→Contrato', valor: await calcConversao(rows) },
  ];
  if (noticias !== null) {
    calculos.push({ indicador: 'Notícias publicadas no blog', valor: noticias });
  }
  if (inscritosGanhos !== null) {
    calculos.push({ indicador: 'Inscritos YouTube ganhos', valor: inscritosGanhos });
  }

  // Leads digitais — vêm do Atende Direito via webhook (aba leads_log).
  // null = webhook ainda não ligado → não mexe no valor lançado manualmente.
  const leadsAtende = await calcLeadsAtendeDireito().catch(() => null);
  if (leadsAtende !== null) {
    calculos.push({ indicador: 'Leads', valor: leadsAtende });
  }

  // Meta Ads — Investimento total do mês (só roda se token configurado)
  let metaSpend = null;
  if (process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID) {
    try {
      metaSpend = await spendDoMesAtual();
      calculos.push({ indicador: 'Investimento Ads total', valor: metaSpend });
    } catch (e) {
      console.error('[meta-ads] erro:', e.message);
    }
  }

  // CPL auto-calc: requer leads (do ADVBOX, já no Sheet) + spend (Meta)
  if (metaSpend !== null) {
    const leads = readRealizado(rows, 'Leads');
    if (leads > 0) {
      const cpl = Math.round((metaSpend / leads) * 100) / 100;
      calculos.push({ indicador: 'CPL', valor: cpl });
    }
  }

  for (const { indicador, valor } of calculos) {
    const row = rows.find(r => String(r['Indicador'] || '').trim() === indicador);
    if (!row) {
      erros.push({ indicador, motivo: 'indicador não encontrado na aba kpis' });
      continue;
    }
    await updateRange('kpis', `C${row.__row}:C${row.__row}`, [[valor]]);
    await updateRange('kpis', `E${row.__row}:E${row.__row}`, [[now]]);
    updates.push({ indicador, novoRealizado: valor });
  }

  return { sincronizados: updates, erros, timestamp: now };
}

export async function runAutoCalcHandler(req, res) {
  try {
    const result = await runAutoCalc();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

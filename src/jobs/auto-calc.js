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

// Lê o valor numérico de Realizado de um indicador
function readRealizado(rows, indicador) {
  const row = rows.find(r => String(r['Indicador'] || '').trim() === indicador);
  if (!row) return null;
  const n = parseFloat(String(row['Realizado'] || '0').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Calcula conversão Lead→Contrato como % inteiro
function calcConversao(rows) {
  const leads = readRealizado(rows, 'Leads');
  const contratos = readRealizado(rows, 'Contratos');
  if (!leads || leads === 0) return 0;
  return Math.round((contratos / leads) * 100);
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
    { indicador: 'Conversão Lead→Contrato', valor: calcConversao(rows) },
  ];
  if (noticias !== null) {
    calculos.push({ indicador: 'Notícias publicadas no blog', valor: noticias });
  }
  if (inscritosGanhos !== null) {
    calculos.push({ indicador: 'Inscritos YouTube ganhos', valor: inscritosGanhos });
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

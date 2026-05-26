// KPIs auto-calculados a partir de dados que JÁ existem no Sheet + APIs externas
// quando o token correspondente está configurado (ADVBOX, Atende Direito, YouTube,
// Meta Ads). Roda a cada ~4h via cron interno (server.js).
//
// KPIs cobertos automaticamente:
//   - "Leads ABADV" (Pipeline de Leads, board 2941) e "Leads AposentaBR" (board 2631)
//     → vêm da API do Atende Direito (cards criados no mês). Separados por marca.
//   - "Vídeos publicados" = cards do calendário com Status="Publicado" no mês.
//   - "Conversão Lead→Contrato" = contratos / leads (janela 60d via ADVBOX).
//   - "Notícias publicadas no blog" (RSS), "Inscritos YouTube ganhos" (YouTube API),
//     "Investimento Ads total" + "CPL" (Meta Ads).
import { readSheet, updateRange, appendRow, listTabs, createTab } from '../lib/sheets.js';
import { countPostsBlogDoMes } from '../lib/blog-rss.js';
import { inscritosGanhosDoMes, getSubscriberCount } from '../lib/youtube.js';
import { spendDoMesAtual } from '../lib/meta-ads.js';
import { countLeadsUltimosDias } from '../lib/advbox.js';
import { countCreatesNoBoard, mesAtualUnix } from '../lib/atende-direito.js';

// Snapshot do total ATUAL de inscritos no YouTube (gravado na aba kpis_historico).
const YT_INDICADOR_SNAPSHOT = '_YouTube Total';

// Boards do Atende Direito que viram indicadores "Leads <Marca>" separados.
// Cada board é o funil de uma marca; SAC fica de fora (não é lead de marketing).
const ATENDE_BRAND_BOARDS = [
  { indicador: 'Leads ABADV',      listId: 2941, metaPadrao: 2500, unidade: 'leads' },
  { indicador: 'Leads AposentaBR', listId: 2631, metaPadrao: 200,  unidade: 'leads' },
];

async function snapshotYoutubeTotal() {
  const tabs = await listTabs();
  if (!tabs.includes('kpis_historico')) {
    await createTab('kpis_historico', ['Data', 'Indicador', 'Realizado', 'Meta', 'Pct']);
  }
  const hoje = new Date().toISOString().slice(0, 10);
  const rows = await readSheet('kpis_historico');
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
    mes: hoje.getMonth(),
  };
}

async function calcVideosPublicados() {
  const cards = await readSheet('calendario').catch(() => []);
  const { ano, mes } = mesAtual();
  let count = 0;
  for (const c of cards) {
    if (!c['Título']) continue;
    if (String(c['Status'] || '').trim() !== 'Publicado') continue;
    const dataPub = String(c['Data Publicação'] || '').slice(0, 10);
    const m = dataPub.match(/^(\d{4})-(\d{2})-/);
    if (!m) continue;
    if (parseInt(m[1], 10) !== ano) continue;
    if (parseInt(m[2], 10) - 1 !== mes) continue;
    count++;
  }
  return count;
}

// Conta leads do mês por marca via API do Atende Direito.
// Retorna array [{indicador, valor, metaPadrao, unidade}] ou null se token ausente.
async function calcLeadsPorMarcaAtende() {
  if (!process.env.ATENDE_API_TOKEN) return null;
  const { start, end } = mesAtualUnix();
  const out = [];
  for (const { indicador, listId, metaPadrao, unidade } of ATENDE_BRAND_BOARDS) {
    const valor = await countCreatesNoBoard(listId, start, end);
    out.push({ indicador, valor, metaPadrao, unidade });
  }
  return out;
}

function readRealizado(rows, indicador) {
  const row = rows.find(r => String(r['Indicador'] || '').trim() === indicador);
  if (!row) return null;
  const n = parseFloat(String(row['Realizado'] || '0').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Soma de leads de marketing (ABADV + AposentaBR) — usado como fallback de
// denominador na Conversão e no CPL quando ADVBOX/Meta não dão.
// Inclui a linha "Leads" legada até a migração rodar.
function readLeadsTotal(rows) {
  const abadv = readRealizado(rows, 'Leads ABADV') || 0;
  const ap = readRealizado(rows, 'Leads AposentaBR') || 0;
  const legacy = readRealizado(rows, 'Leads') || 0;
  return abadv + ap + legacy;
}

async function calcConversao(rows) {
  const contratos = readRealizado(rows, 'Contratos');
  let leadsJanela = 0;
  if (process.env.ADVBOX_TOKEN) {
    leadsJanela = await countLeadsUltimosDias(60).catch(() => 0);
  }
  if (!leadsJanela) leadsJanela = readLeadsTotal(rows);
  if (!leadsJanela || leadsJanela === 0) return 0;
  return Math.round((contratos / leadsJanela) * 100);
}

// Migração one-shot e idempotente: se a linha "Leads" antiga ainda existe na aba
// kpis e ainda não temos "Leads ABADV", renomeia o Indicador da linha pra "Leads
// ABADV" (preservando meta, realizado, unidade e tudo mais). Mutates `rows`.
async function migrateLeadsToAbadv(rows) {
  const temNovo = rows.some(r => String(r['Indicador'] || '').trim() === 'Leads ABADV');
  const legacy = rows.find(r => String(r['Indicador'] || '').trim() === 'Leads');
  if (temNovo || !legacy) return false;
  await updateRange('kpis', `A${legacy.__row}:A${legacy.__row}`, [['Leads ABADV']]);
  legacy['Indicador'] = 'Leads ABADV';
  return true;
}

export async function runAutoCalc() {
  let rows = await readSheet('kpis');
  const now = new Date().toISOString();
  const updates = [];
  const erros = [];

  // Migração leve: "Leads" → "Leads ABADV" (idempotente)
  await migrateLeadsToAbadv(rows).catch(e => console.error('[migrate-leads] erro:', e.message));

  const noticias = await countPostsBlogDoMes().catch(e => { console.error('[blog-rss] erro:', e.message); return null; });

  let inscritosGanhos = null;
  try {
    await snapshotYoutubeTotal();
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

  // Leads por marca via Atende Direito → "Leads ABADV" + "Leads AposentaBR"
  const leadsPorMarca = await calcLeadsPorMarcaAtende().catch(e => {
    console.error('[atende-direito] erro:', e.message); return null;
  });
  if (leadsPorMarca) {
    for (const x of leadsPorMarca) calculos.push(x);
  }

  let metaSpend = null;
  if (process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID) {
    try {
      metaSpend = await spendDoMesAtual();
      calculos.push({ indicador: 'Investimento Ads total', valor: metaSpend });
    } catch (e) {
      console.error('[meta-ads] erro:', e.message);
    }
  }

  if (metaSpend !== null) {
    const leads = readLeadsTotal(rows);
    if (leads > 0) {
      const cpl = Math.round((metaSpend / leads) * 100) / 100;
      calculos.push({ indicador: 'CPL', valor: cpl });
    }
  }

  for (const { indicador, valor, metaPadrao, unidade } of calculos) {
    const row = rows.find(r => String(r['Indicador'] || '').trim() === indicador);
    if (!row) {
      // Auto-cria a linha (ex.: "Leads AposentaBR" na primeira vez que aparece)
      try {
        await appendRow('kpis', {
          'Indicador': indicador,
          'Meta': metaPadrao || 0,
          'Realizado': valor,
          'Unidade': unidade || '',
          'Atualizado em': now,
          'Tiers': '',
        });
        updates.push({ indicador, novoRealizado: valor, criado: true });
        rows = await readSheet('kpis'); // recarrega pra próximas iterações
      } catch (e) {
        erros.push({ indicador, motivo: 'falha ao criar linha: ' + e.message });
      }
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

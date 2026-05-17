// KPIs auto-calculados a partir de dados que JÁ existem no Sheet.
// Não depende de API externa. Roda após o sync ADVBOX (precisa de Leads+Contratos atualizados).
//
// KPIs cobertos:
//   - "Vídeos publicados" = count de cards do calendário com Status="Publicado" e Data Publicação no mês corrente
//   - "Conversão Lead→Contrato" = (Contratos / Leads) × 100, arredondado pra inteiro
import { readSheet, updateRange } from '../lib/sheets.js';
import { countPostsBlogDoMes } from '../lib/blog-rss.js';

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

  const calculos = [
    { indicador: 'Vídeos publicados', valor: await calcVideosPublicados() },
    { indicador: 'Conversão Lead→Contrato', valor: calcConversao(rows) },
  ];
  if (noticias !== null) {
    calculos.push({ indicador: 'Notícias publicadas no blog', valor: noticias });
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

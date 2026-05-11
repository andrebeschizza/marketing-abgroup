// Job de alertas automáticos. Roda 1x/dia (via cron interno em server.js).
// 3 checagens: KPIs em risco · Cards estagnados · Pauta vencida.
// Idempotente por dia: usa título único e alreadyNotifiedToday.
import { readSheet } from '../lib/sheets.js';
import { notify, alreadyNotifiedToday } from '../api/notificacoes.js';

const STATUS_EDITANDO = 'Editando';
const DIAS_ESTAGNACAO = 3;

// 1) KPIs em risco: dia do mês ≥ 20 e pct < 70%
async function checkKpisEmRisco() {
  const hoje = new Date();
  const dia = hoje.getDate();
  if (dia < 20) return { skipped: true, reason: `dia ${dia} < 20` };

  const kpis = await readSheet('kpis').catch(() => []);
  const acionados = [];
  for (const k of kpis) {
    if (!k['Indicador']) continue;
    const meta = parseFloat(String(k['Meta'] || '0').replace(',', '.')) || 0;
    const real = parseFloat(String(k['Realizado'] || '0').replace(',', '.')) || 0;
    if (meta <= 0) continue;
    const pct = Math.round((real / meta) * 100);
    if (pct >= 70) continue;
    const diasRestantes = ultimoDiaDoMes(hoje) - dia;
    const titulo = `🔴 KPI em risco: ${k['Indicador']} (${pct}%)`;
    if (await alreadyNotifiedToday(titulo)) continue;
    await notify({
      tipo: 'alerta_kpi',
      titulo,
      detalhe: `Realizado ${real} de meta ${meta}. Faltam ${diasRestantes} dias úteis no mês.`,
      url: '/#dashboard',
      para: 'mkt',
    });
    acionados.push(k['Indicador']);
  }
  return { acionados };
}

// 2) Cards "Editando" há mais de 3 dias
async function checkCardsEstagnados() {
  const cards = await readSheet('calendario').catch(() => []);
  const limite = Date.now() - DIAS_ESTAGNACAO * 24 * 60 * 60 * 1000;
  const acionados = [];
  for (const c of cards) {
    if (!c['Título']) continue;
    if (c['Status'] !== STATUS_EDITANDO) continue;
    const atualizado = c['Atualizado em'];
    if (!atualizado) continue;
    const t = new Date(atualizado).getTime();
    if (isNaN(t) || t >= limite) continue;
    const diasParado = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
    const titulo = `⏳ Estagnado em edição: ${c['Título']}`;
    if (await alreadyNotifiedToday(titulo)) continue;
    await notify({
      tipo: 'alerta_estagnado',
      titulo,
      detalhe: `Card está em "Editando" há ${diasParado} dias. Acompanhe o vídeomaker.`,
      url: '/#calendario',
      para: 'mkt',
      marca: c['Marca'] || '',
    });
    acionados.push(c['Título']);
  }
  return { acionados };
}

// 3) Pauta vencida: Data Publicação = hoje e Link Publicação vazio
async function checkPautaVencida() {
  const cards = await readSheet('calendario').catch(() => []);
  const hoje = new Date().toISOString().slice(0, 10);
  const acionados = [];
  for (const c of cards) {
    if (!c['Título']) continue;
    const dataPub = String(c['Data Publicação'] || '').slice(0, 10);
    if (dataPub !== hoje) continue;
    if (c['Link Publicação']) continue; // já tem link, ok
    if (c['Status'] === 'Publicado') continue;
    const titulo = `📅 Publica hoje sem link: ${c['Título']}`;
    if (await alreadyNotifiedToday(titulo)) continue;
    await notify({
      tipo: 'alerta_pauta',
      titulo,
      detalhe: `Card com data de publicação hoje mas ainda sem Link Publicação. Status: ${c['Status'] || '?'}.`,
      url: '/#calendario',
      para: 'mkt',
      marca: c['Marca'] || '',
    });
    acionados.push(c['Título']);
  }
  return { acionados };
}

function ultimoDiaDoMes(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// Roda todas as checagens
export async function runAlerts() {
  const inicio = Date.now();
  const out = {};
  try {
    out.kpisEmRisco = await checkKpisEmRisco();
  } catch (e) { out.kpisEmRisco = { error: e.message }; }
  try {
    out.cardsEstagnados = await checkCardsEstagnados();
  } catch (e) { out.cardsEstagnados = { error: e.message }; }
  try {
    out.pautaVencida = await checkPautaVencida();
  } catch (e) { out.pautaVencida = { error: e.message }; }
  out.duracaoMs = Date.now() - inicio;
  return out;
}

// Endpoint manual pra disparar (admin)
export async function runAlertsHandler(req, res) {
  try {
    const result = await runAlerts();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// Marketing AB Group — Express server
import 'dotenv/config';
import express from 'express';
import cookieSession from 'cookie-session';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { requireAuth, requireAdmin, validateLogin, PERFIS } from './middleware/auth.js';
import { ping } from './lib/sheets.js';
import { getKpis, seedKpis, updateKpi, snapshotKpis, getKpiHistorico } from './api/kpis.js';
import { listDemandas, createDemanda, updateDemandaStatus } from './api/demandas.js';
import { listAgentes, listAcionaveis, acionarAgente, listAgentesLog } from './api/agentes.js';
import { listAlertas, createAlerta } from './api/alertas.js';
import { listAtalhos } from './api/atalhos.js';
import { listCalendario, createCalendarioItem, updateCalendarioItem, updateCalendarioStatus, deleteCalendarioItem, migrateFromNotion } from './api/calendario.js';
import { listNotificacoes, createNotificacao, marcarLida, marcarTodasLidas } from './api/notificacoes.js';
import { runAlertsHandler, runAlerts } from './jobs/alerts.js';
import { syncAdvboxHandler, syncAdvbox } from './jobs/advbox-sync.js';
import { runAutoCalcHandler, runAutoCalc } from './jobs/auto-calc.js';
import { dispararResumoHandler, dispararResumoSemanal, ehHorarioResumo } from './jobs/resumo-semanal.js';
import { webhookAtendeDireito, webhookAtendeStatus } from './api/webhook-atende.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// cookie-session: dados do usuário ficam na ASSINATURA do cookie do navegador.
// Sobrevive a reinícios do servidor (Render free tier) — sem store backend.
app.use(cookieSession({
  name: 'ab_sess',
  keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
}));

// Anti-cache pra HTML (evita browser servir index.html antigo após reinício)
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html' || req.path === '/login' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// ===== HEALTH =====
app.get('/healthz', async (req, res) => {
  const sheets = await ping();
  res.status(sheets.ok ? 200 : 503).json({
    ok: sheets.ok,
    sheets,
    uptime: process.uptime(),
  });
});

// ===== AUTH =====
app.post('/login', (req, res) => {
  const { password, perfil } = req.body || {};

  // Default perfil = mkt (compatibilidade com login legado que só passa password)
  const perfilKey = (perfil || 'mkt').toString().toLowerCase().trim();
  const validated = validateLogin(perfilKey, password);
  if (!validated) {
    return res.status(401).json({ error: 'Perfil ou senha incorretos' });
  }

  req.session.authenticated = true;
  req.session.perfil = validated;
  req.session.loggedAt = Date.now();
  res.json({ ok: true, perfil: validated });
});

app.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// Lista perfis disponíveis (público — usado pela tela de login)
app.get('/api/perfis', (req, res) => {
  const list = Object.entries(PERFIS).map(([key, conf]) => ({
    key, label: conf.label, marca: conf.marca, admin: conf.admin,
  }));
  res.json({ perfis: list });
});

app.get('/api/me', (req, res) => {
  if (!req.session?.authenticated) {
    return res.status(401).json({ authenticated: false });
  }
  const perfil = req.session.perfil || 'mkt';
  const conf = PERFIS[perfil] || PERFIS.mkt;
  res.json({
    authenticated: true,
    since: req.session.loggedAt,
    perfil,
    perfilLabel: conf.label,
    marca: conf.marca,
    admin: conf.admin,
  });
});

// ===== ROTAS PÚBLICAS =====
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// ===== WEBHOOK PÚBLICO (Atende Direito → Leads) =====
// Registrado ANTES do requireAuth: o n8n não tem sessão, autentica por token.
app.post('/api/webhook/atende-direito', webhookAtendeDireito);
app.get('/api/webhook/atende-direito', webhookAtendeStatus);

// ===== ROTAS PROTEGIDAS =====
app.use('/api', requireAuth);

// GET é livre pra qualquer perfil autenticado.
// POST/PATCH/DELETE: apenas perfil 'mkt' (admin).
app.get('/api/kpis', getKpis);
app.get('/api/kpis/:indicador/historico', getKpiHistorico);
app.patch('/api/kpis/:indicador', requireAdmin, updateKpi);
app.post('/api/admin/seed-kpis', requireAdmin, seedKpis);
app.post('/api/admin/snapshot-kpis', requireAdmin, snapshotKpis);
app.post('/api/admin/run-alerts', requireAdmin, runAlertsHandler);
app.post('/api/admin/resumo-semanal', requireAdmin, dispararResumoHandler);
app.post('/api/admin/sync-advbox', requireAdmin, syncAdvboxHandler);
app.post('/api/admin/auto-calc', requireAdmin, runAutoCalcHandler);
app.get('/api/admin/meta-healthcheck', requireAdmin, async (req, res) => {
  const { metaHealthcheck } = await import('./lib/meta-ads.js');
  res.json(await metaHealthcheck());
});

// Reset baseline YouTube — apaga os snapshots de "_YouTube Total" do mês corrente
// Útil quando: muda de mês, começa campanha nova, ou quer recalibrar.
// Próximo cron vai criar baseline novo a partir do total atual.
app.post('/api/admin/reset-baseline-yt', requireAdmin, async (req, res) => {
  try {
    const { readSheet, deleteRow } = await import('./lib/sheets.js');
    const hoje = new Date();
    const prefixo = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    const rows = await readSheet('kpis_historico');
    // Identifica rows a deletar (mês atual + indicador _YouTube Total)
    const alvos = rows
      .filter(r => String(r['Indicador'] || '') === '_YouTube Total')
      .filter(r => String(r['Data'] || '').startsWith(prefixo))
      .map(r => r.__row)
      .sort((a, b) => b - a); // deleta de baixo pra cima pra preservar índices
    let apagados = 0;
    for (const row of alvos) {
      await deleteRow('kpis_historico', row);
      apagados++;
    }
    res.json({ ok: true, apagados, mes: prefixo, message: `${apagados} snapshots de YouTube removidos. Próximo sync recria baseline.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sync de TUDO — botão "Sincronizar agora" no dashboard
app.post('/api/admin/sync-all', requireAdmin, async (req, res) => {
  const inicio = Date.now();
  const out = {};
  try {
    if (process.env.ADVBOX_TOKEN) {
      out.advbox = await syncAdvbox();
    } else {
      out.advbox = { skipped: 'ADVBOX_TOKEN não configurado' };
    }
  } catch (e) { out.advbox = { error: e.message }; }
  try {
    out.autoCalc = await runAutoCalc();
  } catch (e) { out.autoCalc = { error: e.message }; }
  out.duracaoMs = Date.now() - inicio;
  res.json({ ok: true, ...out });
});

app.get('/api/demandas', listDemandas);
app.post('/api/demandas', requireAdmin, createDemanda);
app.patch('/api/demandas/:row/status', requireAdmin, updateDemandaStatus);

app.get('/api/agentes', listAgentes);
app.get('/api/agentes/acionaveis', listAcionaveis);
app.get('/api/agentes/log', listAgentesLog);
app.post('/api/agentes/:codigo/acionar', requireAdmin, acionarAgente);

app.get('/api/alertas', listAlertas);
app.post('/api/alertas', requireAdmin, createAlerta);

app.get('/api/atalhos', listAtalhos);

app.get('/api/calendario', listCalendario);
app.post('/api/calendario', requireAdmin, createCalendarioItem);
app.patch('/api/calendario/:row/status', requireAdmin, updateCalendarioStatus);
app.patch('/api/calendario/:row', requireAdmin, updateCalendarioItem);
app.delete('/api/calendario/:row', requireAdmin, deleteCalendarioItem);
app.post('/api/calendario/migrate-from-notion', requireAdmin, migrateFromNotion);

// Notificações in-app (substitui Telegram)
app.get('/api/notificacoes', listNotificacoes);
app.post('/api/notificacoes', requireAdmin, createNotificacao);
app.patch('/api/notificacoes/marcar-todas-lidas', marcarTodasLidas);
app.patch('/api/notificacoes/:row/lida', marcarLida);

// ===== STATIC + SPA =====
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.session?.authenticated) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  return res.redirect('/login');
});

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Erro interno' });
});

app.listen(PORT, () => {
  console.log(`Marketing AB Group rodando em http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/healthz`);

  // Cron interno: snapshot diário dos KPIs (idempotente — pula se já fez hoje)
  // Roda 60s após start (dá tempo do Sheets autenticar) e depois a cada 6h
  // (6h ao invés de 24h pra cobrir restarts e timezone shifts. snapshotKpis é idempotente.)
  const runSnapshot = async () => {
    try {
      const fakeReq = {}, fakeRes = { json: (x) => x, status: () => fakeRes };
      const { snapshotKpis: fn } = await import('./api/kpis.js');
      await fn(fakeReq, fakeRes);
      console.log(`[cron] snapshot-kpis @ ${new Date().toISOString()}`);
    } catch (e) {
      console.error('[cron] snapshot-kpis failed:', e.message);
    }
  };
  setTimeout(runSnapshot, 60 * 1000);
  setInterval(runSnapshot, 6 * 60 * 60 * 1000);

  // Cron interno: alertas automáticos 1x/dia (90s após boot + a cada 24h)
  const runAlertsCron = async () => {
    try {
      const out = await runAlerts();
      const counts = {
        kpis: out.kpisEmRisco?.acionados?.length || 0,
        estagnados: out.cardsEstagnados?.acionados?.length || 0,
        pauta: out.pautaVencida?.acionados?.length || 0,
      };
      console.log(`[cron] alerts @ ${new Date().toISOString()} ·`, counts);
    } catch (e) {
      console.error('[cron] alerts failed:', e.message);
    }
  };
  setTimeout(runAlertsCron, 90 * 1000);
  setInterval(runAlertsCron, 24 * 60 * 60 * 1000);

  // Cron interno: resumo semanal — checa a cada 1h se é sexta 17h (Brasília)
  const runResumoCron = async () => {
    if (!ehHorarioResumo()) return;
    try {
      const out = await dispararResumoSemanal();
      console.log(`[cron] resumo-semanal @ ${new Date().toISOString()} ·`, out);
    } catch (e) {
      console.error('[cron] resumo-semanal failed:', e.message);
    }
  };
  setInterval(runResumoCron, 60 * 60 * 1000); // a cada 1h

  // Cron interno: sync ADVBOX 1x a cada 4h (KPIs Leads/Qualificados/Atendidos/Contratos),
  // SEGUIDO de auto-calc (Vídeos publicados + Conversão).
  // 120s após boot pra não estourar rate limit no startup, depois 4h em 4h.
  const runAdvboxSyncCron = async () => {
    if (process.env.ADVBOX_TOKEN) {
      try {
        const out = await syncAdvbox();
        console.log(`[cron] advbox-sync @ ${new Date().toISOString()} ·`, {
          ok: out.sincronizados.length,
          erros: out.erros.length,
        });
      } catch (e) {
        console.error('[cron] advbox-sync failed:', e.message);
      }
    } else {
      console.log('[cron] advbox-sync: pulado (ADVBOX_TOKEN não configurado)');
    }
    // Auto-calc roda independente do ADVBOX (mas depois, pra Conversão pegar Leads/Contratos novos)
    try {
      const out = await runAutoCalc();
      console.log(`[cron] auto-calc @ ${new Date().toISOString()} ·`, {
        ok: out.sincronizados.length,
        erros: out.erros.length,
      });
    } catch (e) {
      console.error('[cron] auto-calc failed:', e.message);
    }
  };
  setTimeout(runAdvboxSyncCron, 120 * 1000);
  setInterval(runAdvboxSyncCron, 4 * 60 * 60 * 1000);
});

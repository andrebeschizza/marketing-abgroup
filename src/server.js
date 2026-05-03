// Marketing AB Group — Express server
import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { requireAuth } from './middleware/auth.js';
import { ping } from './lib/sheets.js';
import { getKpis } from './api/kpis.js';
import { listDemandas, createDemanda, updateDemandaStatus } from './api/demandas.js';
import { listAgentes } from './api/agentes.js';
import { listAlertas, createAlerta } from './api/alertas.js';
import { listAtalhos } from './api/atalhos.js';
import { listCalendario, createCalendarioItem, updateCalendarioStatus, migrateFromNotion } from './api/calendario.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
  },
}));

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
  const { password } = req.body || {};
  const expected = process.env.AB_PASSWORD;

  if (!expected) {
    return res.status(503).json({ error: 'Servidor sem AB_PASSWORD configurado' });
  }
  if (password !== expected) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }

  req.session.authenticated = true;
  req.session.loggedAt = Date.now();
  res.json({ ok: true });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session?.authenticated) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({ authenticated: true, since: req.session.loggedAt });
});

// ===== ROTAS PÚBLICAS =====
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// ===== ROTAS PROTEGIDAS =====
app.use('/api', requireAuth);

app.get('/api/kpis', getKpis);

app.get('/api/demandas', listDemandas);
app.post('/api/demandas', createDemanda);
app.patch('/api/demandas/:row/status', updateDemandaStatus);

app.get('/api/agentes', listAgentes);

app.get('/api/alertas', listAlertas);
app.post('/api/alertas', createAlerta);

app.get('/api/atalhos', listAtalhos);

app.get('/api/calendario', listCalendario);
app.post('/api/calendario', createCalendarioItem);
app.patch('/api/calendario/:row/status', updateCalendarioStatus);
app.post('/api/calendario/migrate-from-notion', migrateFromNotion);

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
});

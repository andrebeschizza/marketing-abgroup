// Middleware: autenticação + autorização por perfil
//
// 6 perfis fixos:
//  - mkt          → Marketing (admin geral, vê tudo, edita tudo)
//  - comercial    → Comercial (read-only de tudo — vê calendário inteiro)
//  - abadv        → Vertical ABADV (admin filtrado pela própria marca)
//  - aposentabr   → Vertical AposentaBR (admin filtrado)
//  - abcred       → Vertical AB CRED (admin filtrado)
//  - vitalidade   → Vertical Vitalidade+ (admin filtrado)
//
// Verticais têm admin=true porque o filtro automático por marca em listCalendario
// já restringe o que eles veem ao próprio escopo. Logo, podem editar/criar/mover
// sem risco de tocar conteúdo de outras verticais.
export const PERFIS = {
  mkt:        { label: 'Marketing',     marca: null,         admin: true  },
  comercial:  { label: 'Comercial',     marca: null,         admin: false },
  abadv:      { label: 'ABADV',         marca: 'ABADV',      admin: true  },
  aposentabr: { label: 'AposentaBR',    marca: 'AposentaBR', admin: true  },
  abcred:     { label: 'AB CRED',       marca: 'AB CRED',    admin: true  },
  vitalidade: { label: 'Vitalidade+',   marca: 'Vitalidade+',admin: true  },
};

// Lê AB_PASSWORDS (JSON com {perfil:senha}). Se ausente, fallback pro AB_PASSWORD legado mapeado pro perfil 'mkt'.
export function getPasswordsMap() {
  const raw = process.env.AB_PASSWORDS;
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* falls through */ }
  }
  // Fallback legado: 1 senha global = perfil mkt
  if (process.env.AB_PASSWORD) {
    return { mkt: process.env.AB_PASSWORD };
  }
  return {};
}

// Valida {perfil, senha} → retorna perfil válido ou null
export function validateLogin(perfil, senha) {
  if (!perfil || !senha) return null;
  const key = String(perfil).toLowerCase().trim();
  if (!PERFIS[key]) return null;
  const map = getPasswordsMap();
  if (map[key] && map[key] === senha) return key;
  return null;
}

export function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  return res.redirect('/login');
}

// Apenas admins (mkt) podem POST/PATCH/DELETE
export function requireAdmin(req, res, next) {
  if (!req.session?.authenticated) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  const perfil = req.session.perfil || 'mkt';
  const conf = PERFIS[perfil];
  if (!conf || !conf.admin) {
    return res.status(403).json({ error: 'Sem permissão. Perfil: ' + perfil });
  }
  return next();
}

export function publicRoute(req, res, next) {
  next();
}

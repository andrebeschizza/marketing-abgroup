// Middleware: protege rotas autenticadas
export function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  return res.redirect('/login');
}

export function publicRoute(req, res, next) {
  next();
}

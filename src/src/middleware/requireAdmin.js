/** À utiliser après authenticate(). Bloque si l'utilisateur n'est pas admin. */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Accès réservé aux administrateurs." });
  }
  next();
}

module.exports = requireAdmin;

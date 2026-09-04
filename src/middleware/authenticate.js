const { verifyToken } = require("../utils/auth");
const db = require("../db");

/**
 * Vérifie le jeton envoyé dans l'en-tête "Authorization: Bearer <token>".
 * Si valide, attache req.user (la ligne complète trouvée en base Supabase).
 */
function authenticate(required = true) {
  return async (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      if (required) return res.status(401).json({ error: "Authentification requise." });
      req.user = null;
      return next();
    }

    try {
      const payload = verifyToken(token);
      const user = await db.getUserById(payload.sub);
      if (!user || user.banned) {
        if (required) return res.status(401).json({ error: "Compte introuvable ou suspendu." });
        req.user = null;
        return next();
      }
      req.user = user;
      next();
    } catch (e) {
      if (required) return res.status(401).json({ error: "Jeton invalide ou expiré." });
      req.user = null;
      next();
    }
  };
}

module.exports = authenticate;

const crypto = require("crypto");
const { db, save } = require("./db");

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const attempt = crypto.scryptSync(String(password), salt, 64).toString("hex");
  // Comparaison en temps constant pour éviter les attaques par timing.
  const a = Buffer.from(attempt, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function publicUser(user) {
  if (!user) return null;
  return {
    username: user.username,
    isAdmin: !!user.isAdmin,
    premiumMode: !!user.premiumMode,
    tier: user.tier || "free",
    gems: Number.isFinite(user.gems) ? user.gems : 0,
    lives: Number.isFinite(user.lives) ? user.lives : 6,
    streak: user.streak || { count: 0, lastPlayTs: 0 },
    history: Array.isArray(user.history) ? user.history : [],
    createdAt: user.createdAt,
  };
}

// Middleware : authentification obligatoire (401 si absente/invalide).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const username = token && db.tokens[token];
  const user = username && db.users[username];
  if (!user) return res.status(401).json({ error: "Non authentifié." });
  req.user = user;
  req.token = token;
  next();
}

// Middleware : authentification facultative (req.user reste undefined sinon).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const username = token && db.tokens[token];
  const user = username && db.users[username];
  if (user) req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: "Réservé aux administrateurs." });
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  publicUser,
  requireAuth,
  optionalAuth,
  requireAdmin,
};

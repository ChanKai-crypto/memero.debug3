const express = require("express");
const { db, save } = require("../lib/db");
const { hashPassword, verifyPassword, generateToken, publicUser, requireAuth } = require("../lib/auth");

const router = express.Router();

function isValidUsername(u) {
  return typeof u === "string" && u.trim().length >= 2 && u.trim().length <= 40;
}

router.post("/auth/signup", (req, res) => {
  const username = String((req.body && req.body.username) || "").trim();
  const password = (req.body && req.body.password) || "";
  if (!isValidUsername(username) || !password) {
    return res.status(400).json({ error: "Pseudo (2-40 caractères) et mot de passe requis." });
  }
  if (db.users[username]) {
    return res.status(409).json({ error: "Ce pseudo existe déjà." });
  }
  const { salt, hash } = hashPassword(password);
  const isFirstUser = Object.keys(db.users).length === 0;
  const user = {
    username,
    salt,
    passwordHash: hash,
    // Le tout premier compte créé sur un serveur fraîchement installé
    // devient automatiquement Admin, pour pouvoir tout configurer.
    isAdmin: isFirstUser,
    premiumMode: false,
    tier: "free",
    gems: 0,
    lives: 6,
    streak: { count: 0, lastPlayTs: 0 },
    history: [],
    createdAt: Date.now(),
  };
  db.users[username] = user;
  const token = generateToken();
  db.tokens[token] = username;
  save();
  res.status(201).json({ token, user: publicUser(user) });
});

router.post("/auth/login", (req, res) => {
  const username = String((req.body && req.body.username) || "").trim();
  const password = (req.body && req.body.password) || "";
  const user = db.users[username];
  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
    return res.status(401).json({ error: "Pseudo ou mot de passe incorrect." });
  }
  const token = generateToken();
  db.tokens[token] = username;
  save();
  res.json({ token, user: publicUser(user) });
});

router.post("/auth/logout", requireAuth, (req, res) => {
  delete db.tokens[req.token];
  save();
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

// Mise à jour de son propre profil : gemmes, vies, série, mode Premium.
// Le statut Admin n'est JAMAIS modifiable par ce endpoint (voir routes/admin.js).
router.patch("/me", requireAuth, (req, res) => {
  const body = req.body || {};
  if (Number.isFinite(body.gems)) req.user.gems = Math.max(0, Math.round(body.gems));
  if (Number.isFinite(body.lives)) req.user.lives = Math.max(0, Math.min(6, Math.round(body.lives)));
  if (body.streak && typeof body.streak === "object") req.user.streak = body.streak;
  if (typeof body.premiumMode === "boolean") req.user.premiumMode = body.premiumMode;
  if (typeof body.tier === "string") req.user.tier = body.tier;
  save();
  res.json(publicUser(req.user));
});

router.get("/me/history", requireAuth, (req, res) => {
  res.json(req.user.history || []);
});

router.post("/me/history", requireAuth, (req, res) => {
  const entry = req.body || {};
  entry.username = req.user.username;
  entry.date = entry.date || Date.now();
  req.user.history = req.user.history || [];
  req.user.history.push(entry);
  if (req.user.history.length > 500) req.user.history = req.user.history.slice(-500);
  save();
  res.status(201).json(entry);
});

module.exports = router;

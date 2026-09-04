const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authenticate");
const { hashPassword, verifyPassword, signToken } = require("../utils/auth");
const { toPublicUser } = require("../utils/mappers");

const router = express.Router();

function defaultSubscription() {
  return {
    tier: "free",
    status: "inactive",
    startedAt: null,
    renewsAt: null,
    provider: null,
    providerTransactionId: null,
  };
}

function defaultGame() {
  return {
    gems: 0,
    lives: { count: 6, lastLossAt: null },
    streak: { count: 0, lastPlayAt: null },
    lifetimeScore: 0,
    inventory: { multiplier: 0, joker: 0 },
    chestsUnlocked: [],
    chestsPending: [],
  };
}

// POST /api/auth/signup
router.post("/signup", async (req, res, next) => {
  try {
    const { username, password, email } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Pseudo et mot de passe requis." });
    }
    if (String(username).trim().length < 3) {
      return res.status(400).json({ error: "Le pseudo doit faire au moins 3 caractères." });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Le mot de passe doit faire au moins 6 caractères." });
    }

    const existing = await db.getUserByUsername(username);
    if (existing) return res.status(409).json({ error: "Ce pseudo existe déjà." });

    const row = await db.createUser({
      username,
      email: email || null,
      password_hash: hashPassword(password),
      role: "user",
      subscription: defaultSubscription(),
      game: defaultGame(),
      stats: { quizzesPlayed: 0 },
    });

    const token = signToken(row);
    res.status(201).json({ token, user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/login
router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Pseudo et mot de passe requis." });
    }

    const row = await db.getUserByUsername(username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: "Pseudo ou mot de passe incorrect." });
    }
    if (row.banned) {
      return res.status(403).json({ error: "Ce compte a été suspendu." });
    }

    const token = signToken(row);
    res.json({ token, user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// GET /api/auth/me
router.get("/me", authenticate(true), (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

module.exports = router;

const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authenticate");
const { toPublicUser } = require("../utils/mappers");
const { hashPassword, verifyPassword } = require("../utils/auth");

const router = express.Router();

const VALID_TIERS = ["free", "bas", "standard", "plus"];

// GET /api/users/me
router.get("/me", authenticate(true), (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

// PATCH /api/users/me  { email?, avatarUrl? }
router.patch("/me", authenticate(true), async (req, res, next) => {
  try {
    const { email, avatarUrl } = req.body || {};
    const patch = {};

    if (typeof email === "string") patch.email = email;
    if (typeof avatarUrl === "string") {
      if (avatarUrl.length > 3_000_000) {
        return res.status(413).json({ error: "Image trop lourde (max ~2 Mo)." });
      }
      if (avatarUrl && !avatarUrl.startsWith("data:image/png")) {
        return res.status(400).json({ error: "Seules les images PNG sont acceptées." });
      }
      patch.avatar_url = avatarUrl || null;
    }

    const row = await db.updateUser(req.user.id, patch);
    res.json({ user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/users/me/game
// ⚠️ Démo : le client envoie l'état de jeu calculé de son côté. Avant une
// vraie mise en production, recalcule/valide ces valeurs côté serveur.
router.patch("/me/game", authenticate(true), async (req, res, next) => {
  try {
    const { gems, lives, streak, lifetimeScore, inventory, chestsUnlocked, chestsPending, stats } =
      req.body || {};
    const current = req.user;
    const game = { ...current.game };

    if (typeof gems === "number") game.gems = Math.max(0, Math.round(gems));
    if (lives && typeof lives === "object") game.lives = { ...game.lives, ...lives };
    if (streak && typeof streak === "object") game.streak = { ...game.streak, ...streak };
    if (typeof lifetimeScore === "number") game.lifetimeScore = Math.max(0, Math.round(lifetimeScore));
    if (inventory && typeof inventory === "object") game.inventory = { ...game.inventory, ...inventory };
    if (Array.isArray(chestsUnlocked)) game.chestsUnlocked = chestsUnlocked;
    if (Array.isArray(chestsPending)) game.chestsPending = chestsPending;

    const patch = { game };
    if (stats && typeof stats === "object") patch.stats = { ...current.stats, ...stats };

    const row = await db.updateUser(req.user.id, patch);
    res.json({ user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// POST /api/users/me/subscribe  { tier: "bas"|"standard"|"plus"|"free" }
// ⚠️ DÉMO SANS PAIEMENT : voir README, section "Aller plus loin" pour
// brancher une vraie vérification Google Play Billing / Stripe.
router.post("/me/subscribe", authenticate(true), async (req, res, next) => {
  try {
    const { tier } = req.body || {};
    if (!VALID_TIERS.includes(tier)) {
      return res.status(400).json({ error: "Palier d'abonnement invalide." });
    }

    const now = new Date().toISOString();
    const subscription = {
      ...req.user.subscription,
      tier,
      status: tier === "free" ? "inactive" : "active",
      startedAt: tier === "free" ? null : now,
      renewsAt: null,
      provider: "demo",
      providerTransactionId: null,
    };

    const patch = { subscription };
    if (tier === "plus") {
      patch.game = {
        ...req.user.game,
        lives: { count: 6, lastLossAt: null },
      };
    }

    const row = await db.updateUser(req.user.id, patch);
    res.json({ user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// POST /api/users/me/history  (une entrée d'historique de partie)
router.post("/me/history", authenticate(true), async (req, res, next) => {
  try {
    const entry = req.body || {};
    if (!entry || typeof entry !== "object") {
      return res.status(400).json({ error: "Entrée d'historique invalide." });
    }
    const history = Array.isArray(req.user.history) ? req.user.history.slice() : [];
    history.push({ ...entry, receivedAt: new Date().toISOString() });
    if (history.length > 500) history.splice(0, history.length - 500);

    const row = await db.updateUser(req.user.id, { history });
    res.status(201).json({ user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// GET /api/users/me/playlists
router.get("/me/playlists", authenticate(true), (req, res) => {
  res.json({ playlists: Array.isArray(req.user.playlists) ? req.user.playlists : [] });
});

// PUT /api/users/me/playlists  { playlists: [...] }
router.put("/me/playlists", authenticate(true), async (req, res, next) => {
  try {
    const { playlists } = req.body || {};
    if (!Array.isArray(playlists)) {
      return res.status(400).json({ error: "playlists doit être un tableau." });
    }
    const row = await db.updateUser(req.user.id, { playlists });
    res.json({ playlists: row.playlists || [] });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/users/me/password  { currentPassword, newPassword }
router.patch("/me/password", authenticate(true), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Mot de passe actuel et nouveau mot de passe requis." });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 6 caractères." });
    }
    if (!verifyPassword(currentPassword, req.user.password_hash)) {
      return res.status(401).json({ error: "Mot de passe actuel incorrect." });
    }

    await db.updateUser(req.user.id, { password_hash: hashPassword(newPassword) });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/users/me  { password }  (le compte doit confirmer son mot de passe)
router.delete("/me", authenticate(true), async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password || !verifyPassword(password, req.user.password_hash)) {
      return res.status(401).json({ error: "Mot de passe incorrect." });
    }
    await db.deleteUser(req.user.id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

module.exports = router;

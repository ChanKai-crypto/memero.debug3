const { hashPassword } = require("../utils/auth");
const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authenticate");
const requireAdmin = require("../middleware/requireAdmin");
const { toPublicUser, toPublicQuiz } = require("../utils/mappers");

const router = express.Router();

// Toutes les routes ci-dessous nécessitent d'être connecté ET administrateur.
router.use(authenticate(true), requireAdmin);

function isSuperadmin(user) {
  return !!user && !!user.protected;
}

// Un compte protégé (indicateur "protected" en base, mis en place via
// scripts/seedAdmin.js — voir supabase-schema.sql) reste un admin tout à
// fait normal pour le reste de l'app (même rôle "admin", donc tous les
// droits admin sans exception), mais ne peut être modifié — rôle,
// bannissement, mot de passe, suppression — que par lui-même ou par un
// autre compte protégé. Un admin "normal" ne peut pas y toucher.
function blockedFromModifyingSuperadmin(req, res, target) {
  if (target.protected && !isSuperadmin(req.user)) {
    res.status(403).json({ error: "Ce compte est protégé (Pilier) : seul un autre compte protégé peut le modifier." });
    return true;
  }
  return false;
}

// GET /api/admin/users
router.get("/users", async (req, res, next) => {
  try {
    const rows = await db.listUsers();
    res.json({ users: rows.map(toPublicUser) });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/users/:id/password  { newPassword }
// Sert de "mot de passe oublié" : sans service d'envoi d'email configuré,
// c'est l'admin qui fixe un nouveau mot de passe pour un compte bloqué,
// à communiquer ensuite au joueur par un autre moyen (message, en personne...).
router.patch("/users/:id/password", async (req, res, next) => {
  try {
    const target = await db.getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: "Compte introuvable." });
    if (blockedFromModifyingSuperadmin(req, res, target)) return;

    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 6 caractères." });
    }

    await db.updateUser(req.params.id, { password_hash: hashPassword(newPassword) });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/users/:id   { role?, subscriptionTier?, gems?, banned? }
router.patch("/users/:id", async (req, res, next) => {
  try {
    const target = await db.getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: "Compte introuvable." });
    if (blockedFromModifyingSuperadmin(req, res, target)) return;

    const { role, subscriptionTier, gems, banned } = req.body || {};
    const patch = {};

    if (role && ["user", "admin"].includes(role)) patch.role = role;
    if (subscriptionTier && ["free", "bas", "standard", "plus"].includes(subscriptionTier)) {
      patch.subscription = {
        ...target.subscription,
        tier: subscriptionTier,
        status: subscriptionTier === "free" ? "inactive" : "active",
      };
    }
    if (typeof gems === "number") {
      patch.game = { ...target.game, gems: Math.max(0, Math.round(gems)) };
    }
    if (typeof banned === "boolean") patch.banned = banned;

    const row = await db.updateUser(req.params.id, patch);
    res.json({ user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "Tu ne peux pas supprimer ton propre compte admin ici." });
    }
    const target = await db.getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: "Compte introuvable." });
    if (blockedFromModifyingSuperadmin(req, res, target)) return;

    await db.deleteUser(req.params.id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/playlists (tous, y compris privés, avec le propriétaire)
router.get("/playlists", async (req, res, next) => {
  try {
    const playlists = await db.listAllPlaylistsAdmin();
    res.json({ playlists });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/playlists/:id  { official?, guided? }
router.patch("/playlists/:id", async (req, res, next) => {
  try {
    const { official, guided } = req.body || {};
    const patch = {};
    if (typeof official === "boolean") patch.official = official;
    if (typeof guided === "boolean") patch.guided = guided;
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "Au moins un champ 'official' ou 'guided' (booléen) est requis." });
    }
    const result = await db.setPlaylistFields(req.params.id, patch);
    if (!result) return res.status(404).json({ error: "Parcours introuvable." });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/playlists/:id
router.delete("/playlists/:id", async (req, res, next) => {
  try {
    const removed = await db.deletePlaylist(req.params.id);
    if (!removed) return res.status(404).json({ error: "Parcours introuvable." });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/quizzes (tous, y compris premiumOnly, sans restriction)
router.get("/quizzes", async (req, res, next) => {
  try {
    const rows = await db.listQuizzes();
    res.json({ quizzes: rows.map(toPublicQuiz) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/quizzes/:id
router.delete("/quizzes/:id", async (req, res, next) => {
  try {
    const existing = await db.getQuizById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Quiz introuvable." });
    await db.deleteQuiz(req.params.id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/quizzes/:id  { premiumOnly?, official? }
router.patch("/quizzes/:id", async (req, res, next) => {
  try {
    const existing = await db.getQuizById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Quiz introuvable." });

    const { premiumOnly, official } = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if (typeof premiumOnly === "boolean") patch.premium_only = premiumOnly;
    if (typeof official === "boolean") patch.official = official;

    const row = await db.updateQuiz(req.params.id, patch);
    res.json({ quiz: toPublicQuiz(row) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

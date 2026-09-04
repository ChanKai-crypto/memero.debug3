const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authenticate");
const requireAdmin = require("../middleware/requireAdmin");
const { toPublicUser, toPublicQuiz } = require("../utils/mappers");

const router = express.Router();

// Toutes les routes ci-dessous nécessitent d'être connecté ET administrateur.
router.use(authenticate(true), requireAdmin);

// GET /api/admin/users
router.get("/users", async (req, res, next) => {
  try {
    const rows = await db.listUsers();
    res.json({ users: rows.map(toPublicUser) });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/users/:id   { role?, subscriptionTier?, gems?, banned? }
router.patch("/users/:id", async (req, res, next) => {
  try {
    const target = await db.getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: "Compte introuvable." });

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

    await db.deleteUser(req.params.id);
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

const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authenticate");
const { toPublicQuiz } = require("../utils/mappers");

const router = express.Router();

function isPremiumUser(user) {
  return !!user && (user.role === "admin" || user.subscription.tier !== "free");
}

function canEdit(user, quiz) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return quiz.owner_id === user.id;
}

// GET /api/quizzes
router.get("/", authenticate(false), async (req, res, next) => {
  try {
    const rows = await db.listQuizzes();
    const premium = isPremiumUser(req.user);

    const list = rows.map((row) => {
      const quiz = toPublicQuiz(row);
      if (quiz.premiumOnly && !premium) {
        const { raw, config, ...locked } = quiz;
        return { ...locked, locked: true };
      }
      return { ...quiz, locked: false };
    });

    res.json({ quizzes: list });
  } catch (e) {
    next(e);
  }
});

// GET /api/quizzes/:id
router.get("/:id", authenticate(false), async (req, res, next) => {
  try {
    const row = await db.getQuizById(req.params.id);
    if (!row) return res.status(404).json({ error: "Quiz introuvable." });

    if (row.premium_only && !isPremiumUser(req.user)) {
      return res.status(403).json({ error: "Ce quiz est réservé aux comptes Premium." });
    }

    res.json({ quiz: toPublicQuiz(row) });
  } catch (e) {
    next(e);
  }
});

// POST /api/quizzes
router.post("/", authenticate(true), async (req, res, next) => {
  try {
    const { title, difficulty, format, raw, config, language, premiumOnly, official } = req.body || {};

    if (!title || !raw) {
      return res.status(400).json({ error: "Titre et contenu du quiz requis." });
    }
    if (premiumOnly && req.user.role !== "admin") {
      return res.status(403).json({ error: "Seul un administrateur peut marquer un quiz Premium." });
    }
    if (official && req.user.role !== "admin") {
      return res.status(403).json({ error: "Seul un administrateur peut marquer un quiz comme officiel." });
    }

    const row = await db.createQuiz({
      owner_id: req.user.id,
      owner_username: req.user.username,
      title: String(title).slice(0, 200),
      difficulty: difficulty || "normal",
      format: format || "pairs",
      raw: String(raw),
      config: config || {},
      language: language || null,
      premium_only: !!premiumOnly,
      official: !!official,
    });

    res.status(201).json({ quiz: toPublicQuiz(row) });
  } catch (e) {
    next(e);
  }
});

// PUT /api/quizzes/:id
router.put("/:id", authenticate(true), async (req, res, next) => {
  try {
    const existing = await db.getQuizById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Quiz introuvable." });
    if (!canEdit(req.user, existing)) return res.status(403).json({ error: "Non autorisé." });

    const { title, difficulty, format, raw, config, language, premiumOnly, official } = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if (title) patch.title = String(title).slice(0, 200);
    if (difficulty) patch.difficulty = difficulty;
    if (format) patch.format = format;
    if (typeof raw === "string") patch.raw = raw;
    if (config) patch.config = config;
    if (language !== undefined) patch.language = language;
    if (typeof premiumOnly === "boolean") {
      if (premiumOnly && req.user.role !== "admin") {
        return res.status(403).json({ error: "Seul un administrateur peut marquer un quiz Premium." });
      }
      patch.premium_only = premiumOnly;
    }
    if (typeof official === "boolean") {
      if (official && req.user.role !== "admin") {
        return res.status(403).json({ error: "Seul un administrateur peut marquer un quiz comme officiel." });
      }
      patch.official = official;
    }

    const row = await db.updateQuiz(req.params.id, patch);
    res.json({ quiz: toPublicQuiz(row) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/quizzes/:id
router.delete("/:id", authenticate(true), async (req, res, next) => {
  try {
    const existing = await db.getQuizById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Quiz introuvable." });
    if (!canEdit(req.user, existing)) return res.status(403).json({ error: "Non autorisé." });

    await db.deleteQuiz(req.params.id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

module.exports = router;

const express = require("express");
const { db, save } = require("../lib/db");
const { requireAuth, optionalAuth } = require("../lib/auth");

const router = express.Router();

function sanitizeIncomingQuiz(body, requester) {
  return {
    id: String(body.id || ("q" + Date.now() + Math.floor(Math.random() * 1000))),
    title: String(body.title || "Quiz sans titre").slice(0, 200),
    difficulty: body.difficulty || "moyen",
    difficultyOverrides: body.difficultyOverrides || {},
    formatOverrides: body.formatOverrides || {},
    format: body.format || "pairs",
    raw: String(body.raw || ""),
    config: body.config || null,
    language: body.language || "fr",
    // Seul un admin peut marquer un quiz Premium/Officiel.
    premiumOnly: !!body.premiumOnly && !!requester.isAdmin,
    official: !!body.official && !!requester.isAdmin,
  };
}

// Liste publique de tous les quiz communautaires (pas besoin d'être connecté
// pour "faire le quiz d'un autre").
router.get("/quizzes", optionalAuth, (req, res) => {
  res.json(db.quizzes);
});

router.get("/quizzes/:id", (req, res) => {
  const quiz = db.quizzes.find((q) => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ error: "Quiz introuvable." });
  res.json(quiz);
});

// Création OU mise à jour (upsert) : le pont frontend envoie l'objet quiz
// complet à chaque changement local ; on crée s'il n'existe pas encore,
// sinon on vérifie que l'appelant a le droit de le modifier.
router.post("/quizzes", requireAuth, (req, res) => {
  const body = req.body || {};
  const existing = body.id ? db.quizzes.find((q) => q.id === body.id) : null;

  if (existing) {
    const canEdit = req.user.isAdmin || existing.author === req.user.username;
    if (!canEdit) return res.status(403).json({ error: "Tu ne peux modifier que tes propres quiz." });
    Object.assign(existing, sanitizeIncomingQuiz(body, req.user), { updatedAt: Date.now() });
    save();
    return res.json(existing);
  }

  const quiz = Object.assign(sanitizeIncomingQuiz(body, req.user), {
    author: req.user.username,
    createdAt: body.createdAt || Date.now(),
  });
  db.quizzes.unshift(quiz);
  save();
  res.status(201).json(quiz);
});

router.put("/quizzes/:id", requireAuth, (req, res) => {
  const quiz = db.quizzes.find((q) => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ error: "Quiz introuvable." });
  const canEdit = req.user.isAdmin || quiz.author === req.user.username;
  if (!canEdit) return res.status(403).json({ error: "Tu ne peux modifier que tes propres quiz." });
  Object.assign(quiz, sanitizeIncomingQuiz(req.body || {}, req.user), { updatedAt: Date.now() });
  save();
  res.json(quiz);
});

router.delete("/quizzes/:id", requireAuth, (req, res) => {
  const idx = db.quizzes.findIndex((q) => q.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Quiz introuvable." });
  const quiz = db.quizzes[idx];
  const canDelete = req.user.isAdmin || quiz.author === req.user.username;
  if (!canDelete) return res.status(403).json({ error: "Tu ne peux supprimer que tes propres quiz." });
  db.quizzes.splice(idx, 1);
  // On retire aussi ce quiz des parcours qui le contenaient.
  db.playlists.forEach((p) => { p.quizIds = (p.quizIds || []).filter((id) => id !== req.params.id); });
  save();
  res.json({ ok: true });
});

// Classement : agrège l'historique de TOUS les comptes pour ce quiz précis.
router.get("/quizzes/:id/leaderboard", (req, res) => {
  const entries = [];
  Object.values(db.users).forEach((user) => {
    (user.history || []).forEach((h) => {
      if (h.id === req.params.id && Number.isFinite(h.score) && h.score > 0) {
        entries.push(Object.assign({}, h, { username: user.username }));
      }
    });
  });
  entries.sort((a, b) => b.score - a.score);
  res.json(entries.slice(0, 100));
});

module.exports = router;

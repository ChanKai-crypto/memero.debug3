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

// PATCH /api/admin/playlists/:id  { official?, guided?, pathType?, sections?, learnSectionId? }
router.patch("/playlists/:id", async (req, res, next) => {
  try {
    const { official, guided, pathType, sections, learnSectionId, learnSectionOrder } = req.body || {};
    const patch = {};
    if (typeof official === "boolean") patch.official = official;
    if (typeof guided === "boolean") patch.guided = guided;
    // Parcours "par sections" (toutes les compétences d'une section
    // débloquées ensemble, un seuil ouvre la suivante) — réservé à cette
    // route admin, jamais exposé à la synchronisation normale des
    // parcours d'un joueur.
    if (pathType === "linear" || pathType === "sectioned") patch.pathType = pathType;
    if (Array.isArray(sections)) patch.sections = sections;
    // Connecte ce parcours à une section Apprendre (string) ou le
    // déconnecte (null) — un parcours connecté disparaît de l'affichage
    // individuel et rejoint sa section à la place.
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "learnSectionId")) {
      patch.learnSectionId = learnSectionId || null;
    }
    // Position dans l'affichage de sa section (éditeur de mise en page).
    if (Number.isFinite(learnSectionOrder)) patch.learnSectionOrder = learnSectionOrder;
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "Au moins un champ 'official', 'guided', 'pathType', 'sections', 'learnSectionId' ou 'learnSectionOrder' est requis." });
    }
    const result = await db.setPlaylistFields(req.params.id, patch);
    if (!result) return res.status(404).json({ error: "Parcours introuvable." });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// === Sections Apprendre (regroupent plusieurs parcours entiers) ===
// Catégories prédéfinies que l'admin peut choisir en créant une section —
// chacune avec son émoticône fixe ; le nom affiché reste personnalisable.
const LEARN_SECTION_CATEGORIES = {
  premiers_pas: "👣",
  grammaire: "📐",
  conjugaison: "🔤",
  vocabulaire: "🏡",
  politesse: "🤝",
  ecoute: "👂",
  lecture: "📖",
};

// GET /api/admin/learn-sections
router.get("/learn-sections", async (req, res, next) => {
  try {
    const sections = await db.listLearnSections();
    res.json({ sections, categories: LEARN_SECTION_CATEGORIES });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/learn-sections  { category, name, unlockThreshold?, sortOrder? }
router.post("/learn-sections", async (req, res, next) => {
  try {
    const { category, name, unlockThreshold, sortOrder } = req.body || {};
    if (!category || !Object.prototype.hasOwnProperty.call(LEARN_SECTION_CATEGORIES, category)) {
      return res.status(400).json({ error: "Catégorie invalide. Choisis parmi : " + Object.keys(LEARN_SECTION_CATEGORIES).join(", ") });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Le nom de la section est requis." });
    }
    const section = await db.createLearnSection({
      id: require("crypto").randomUUID(),
      category,
      name: String(name).trim(),
      emoji: LEARN_SECTION_CATEGORIES[category],
      unlockThreshold: unlockThreshold || { type: "count", value: 1 },
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    });
    res.json(section);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/learn-sections/:id  { name?, category?, unlockThreshold?, sortOrder?, itemsPerRow? }
router.patch("/learn-sections/:id", async (req, res, next) => {
  try {
    const { category } = req.body || {};
    const patch = { ...req.body };
    if (category) {
      if (!Object.prototype.hasOwnProperty.call(LEARN_SECTION_CATEGORIES, category)) {
        return res.status(400).json({ error: "Catégorie invalide." });
      }
      patch.emoji = LEARN_SECTION_CATEGORIES[category];
    }
    const section = await db.updateLearnSection(req.params.id, patch);
    if (!section) return res.status(404).json({ error: "Section introuvable." });
    res.json(section);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/learn-sections/:id
router.delete("/learn-sections/:id", async (req, res, next) => {
  try {
    await db.deleteLearnSection(req.params.id);
    res.json({ ok: true });
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

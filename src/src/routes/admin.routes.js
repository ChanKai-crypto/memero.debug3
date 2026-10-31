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

// PATCH /api/admin/playlists/:id  { official?, guided?, learnSectionId?, learnSectionOrder? }
router.patch("/playlists/:id", async (req, res, next) => {
  try {
    const { official, guided, learnSectionId, learnSectionOrder } = req.body || {};
    const patch = {};
    if (typeof official === "boolean") patch.official = official;
    if (typeof guided === "boolean") patch.guided = guided;
    // Connecte ce parcours à une section Apprendre (string) ou le
    // déconnecte (null) — un parcours connecté disparaît de l'affichage
    // individuel et rejoint sa section à la place.
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "learnSectionId")) {
      patch.learnSectionId = learnSectionId || null;
    }
    // Position dans l'affichage de sa section (éditeur de mise en page).
    if (Number.isFinite(learnSectionOrder)) patch.learnSectionOrder = learnSectionOrder;
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "Au moins un champ 'official', 'guided', 'learnSectionId' ou 'learnSectionOrder' est requis." });
    }
    const result = await db.setPlaylistFields(req.params.id, patch);
    if (!result) return res.status(404).json({ error: "Parcours introuvable." });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// === Arbres (un par thème : sujet + style visuel) ===
// Fonds proposés pour un arbre (l'app les traduit en dégradés).
const LEARN_TREE_BACKGROUNDS = ["default", "foret", "ocean", "desert", "nuit", "aurore", "ardoise"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Code de langue ISO 639-1 / 639-2 (2 ou 3 lettres), ou "" pour toutes les langues.
const LEARN_TREE_LANGUAGE_RE = /^([a-z]{2,3})?$/;

function validateTreeBody(body, partial) {
  const out = {};
  const b = body || {};
  if (b.name !== undefined || !partial) {
    if (!b.name || !String(b.name).trim()) return { error: "Le nom de l'arbre est requis." };
    out.name = String(b.name).trim().slice(0, 80);
  }
  if (b.subject !== undefined) out.subject = String(b.subject || "").trim().slice(0, 80);
  if (b.emoji !== undefined) {
    const e = String(b.emoji || "").trim();
    if (!e || e.length > 16) return { error: "Icône invalide." };
    out.emoji = e;
  }
  if (b.color !== undefined) {
    if (!HEX_COLOR.test(String(b.color))) return { error: "Couleur invalide (format #RRGGBB attendu)." };
    out.color = String(b.color);
  }
  if (b.background !== undefined) {
    if (!LEARN_TREE_BACKGROUNDS.includes(b.background)) return { error: "Fond invalide. Choisis parmi : " + LEARN_TREE_BACKGROUNDS.join(", ") };
    out.background = b.background;
  }
  // Langue des joueurs qui voient cet arbre ("" = toutes les langues).
  if (b.language !== undefined) {
    const l = String(b.language || "");
    if (!LEARN_TREE_LANGUAGE_RE.test(l)) return { error: "Langue invalide (code de 2 ou 3 lettres, ou vide pour toutes)." };
    out.language = l;
  }
  if (Number.isFinite(b.sortOrder)) out.sortOrder = b.sortOrder;
  return { patch: out };
}

// GET /api/admin/learn-trees
router.get("/learn-trees", async (req, res, next) => {
  try {
    const trees = await db.listLearnTrees();
    res.json({ trees, backgrounds: LEARN_TREE_BACKGROUNDS });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/learn-trees  { name, subject?, emoji?, color?, background?, sortOrder? }
router.post("/learn-trees", async (req, res, next) => {
  try {
    const v = validateTreeBody(req.body, false);
    if (v.error) return res.status(400).json({ error: v.error });
    const tree = await db.createLearnTree({ id: require("crypto").randomUUID(), ...v.patch });
    res.json(tree);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/learn-trees/:id  { name?, subject?, emoji?, color?, background?, sortOrder? }
router.patch("/learn-trees/:id", async (req, res, next) => {
  try {
    const v = validateTreeBody(req.body, true);
    if (v.error) return res.status(400).json({ error: v.error });
    const tree = await db.updateLearnTree(req.params.id, v.patch);
    if (!tree) return res.status(404).json({ error: "Arbre introuvable." });
    res.json(tree);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/learn-trees/:id — supprime aussi ses sections ; les
// parcours qu'elles contenaient ne sont pas supprimés (juste "hors section").
router.delete("/learn-trees/:id", async (req, res, next) => {
  try {
    await db.deleteLearnTree(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// === Sections (regroupent plusieurs parcours entiers, dans un arbre) ===
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

// Icône libre d'une section (remplace celle de la catégorie si fournie) :
// utile pour les arbres dont le sujet n'est pas une langue.
function cleanEmoji(v) {
  const e = String(v || "").trim();
  return e && e.length <= 16 ? e : null;
}

// POST /api/admin/learn-sections  { treeId, category, name, emoji?, unlockThreshold?, sortOrder?, itemsPerRow? }
router.post("/learn-sections", async (req, res, next) => {
  try {
    const { treeId, category, name, emoji, unlockThreshold, sortOrder, itemsPerRow } = req.body || {};
    if (!treeId || !(await db.getLearnTree(String(treeId)))) {
      return res.status(400).json({ error: "Arbre introuvable : choisis l'arbre dans lequel créer la section." });
    }
    if (!category || !Object.prototype.hasOwnProperty.call(LEARN_SECTION_CATEGORIES, category)) {
      return res.status(400).json({ error: "Catégorie invalide. Choisis parmi : " + Object.keys(LEARN_SECTION_CATEGORIES).join(", ") });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Le nom de la section est requis." });
    }
    const section = await db.createLearnSection({
      id: require("crypto").randomUUID(),
      treeId: String(treeId),
      category,
      name: String(name).trim(),
      emoji: cleanEmoji(emoji) || LEARN_SECTION_CATEGORIES[category],
      itemsPerRow,
      unlockThreshold: unlockThreshold || { type: "count", value: 1 },
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    });
    res.json(section);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/learn-sections/:id  { treeId?, name?, category?, emoji?, unlockThreshold?, sortOrder?, itemsPerRow? }
router.patch("/learn-sections/:id", async (req, res, next) => {
  try {
    const { category, emoji, treeId } = req.body || {};
    const patch = { ...req.body };
    delete patch.emoji;
    if (category) {
      if (!Object.prototype.hasOwnProperty.call(LEARN_SECTION_CATEGORIES, category)) {
        return res.status(400).json({ error: "Catégorie invalide." });
      }
      patch.emoji = LEARN_SECTION_CATEGORIES[category];
    }
    if (emoji !== undefined) {
      const e = cleanEmoji(emoji);
      if (!e) return res.status(400).json({ error: "Icône invalide." });
      patch.emoji = e;
    }
    if (treeId !== undefined) {
      if (!treeId || !(await db.getLearnTree(String(treeId)))) return res.status(400).json({ error: "Arbre introuvable." });
      patch.treeId = String(treeId);
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
